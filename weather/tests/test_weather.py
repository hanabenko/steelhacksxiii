"""Weather profile and vType physics tests. No SUMO binaries required."""

from __future__ import annotations

import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from weather import (  # noqa: E402
    DEFAULT_WEATHER,
    WEATHER_PROFILES,
    apply_to_pedestrian_rate,
    apply_to_vtype,
    get_profile,
    monthly_exposure,
    sample_condition,
    stopping_distance_m,
)

DRY_VTYPE = {
    "id": "calibrated_passenger", "vClass": "passenger",
    "accel": "2.6", "decel": "4.5", "sigma": "0.50", "length": "5.0",
    "minGap": "2.5", "maxSpeed": "11.176", "speedFactor": "0.640", "speedDev": "0.160",
}
BAD = ["rain", "storm", "snow"]


class TestProfiles(unittest.TestCase):
    def test_clear_is_the_untouched_reference(self) -> None:
        profile = get_profile("clear")
        for scale in (profile.speed_factor_scale, profile.capacity_scale,
                      profile.decel_scale, profile.emergency_decel_scale,
                      profile.pedestrian_scale, profile.friction_coefficient):
            self.assertEqual(scale, 1.0)
        self.assertEqual(apply_to_vtype(DRY_VTYPE, "clear")["speedFactor"], DRY_VTYPE["speedFactor"])

    def test_conditions_are_monotonically_worse(self) -> None:
        order = ["clear", "rain", "storm", "snow"]
        for attr in ("speed_factor_scale", "capacity_scale", "emergency_decel_scale",
                     "friction_coefficient"):
            values = [getattr(WEATHER_PROFILES[c], attr) for c in order]
            with self.subTest(attr=attr):
                self.assertEqual(values, sorted(values, reverse=True), f"{attr} must worsen")

    def test_unknown_weather_raises(self) -> None:
        for bad in ("hurricane", "", "Sunny-ish"):
            with self.subTest(value=bad), self.assertRaises(ValueError):
                get_profile(bad)

    def test_ids_match_the_frontend_catalog(self) -> None:
        self.assertEqual(set(WEATHER_PROFILES), {"clear", "rain", "storm", "snow"})

    def test_every_profile_records_provenance(self) -> None:
        for name, profile in WEATHER_PROFILES.items():
            with self.subTest(weather=name):
                self.assertTrue(profile.provenance.strip())


class TestVTypePhysics(unittest.TestCase):
    def test_bad_weather_reduces_speed_and_braking(self) -> None:
        for weather in BAD:
            with self.subTest(weather=weather):
                out = apply_to_vtype(DRY_VTYPE, weather)
                self.assertLess(float(out["speedFactor"]), float(DRY_VTYPE["speedFactor"]))
                self.assertLess(float(out["decel"]), float(DRY_VTYPE["decel"]))
                self.assertGreater(float(out["minGap"]), float(DRY_VTYPE["minGap"]))
                self.assertGreater(float(out["sigma"]), float(DRY_VTYPE["sigma"]))

    def test_sumo_decel_invariant_holds(self) -> None:
        """SUMO rejects a vType whose emergencyDecel is below decel."""
        for weather in ["clear", *BAD]:
            with self.subTest(weather=weather):
                out = apply_to_vtype(DRY_VTYPE, weather)
                self.assertGreaterEqual(
                    float(out["emergencyDecel"]), float(out["decel"]),
                    "emergencyDecel must never fall below decel",
                )

    def test_emergency_braking_degrades_with_conditions(self) -> None:
        values = [float(apply_to_vtype(DRY_VTYPE, w)["emergencyDecel"])
                  for w in ["clear", "rain", "storm", "snow"]]
        self.assertEqual(values, sorted(values, reverse=True))

    def test_sigma_is_clamped_to_one(self) -> None:
        out = apply_to_vtype({**DRY_VTYPE, "sigma": "0.95"}, "snow")
        self.assertLessEqual(float(out["sigma"]), 1.0)

    def test_input_is_not_mutated(self) -> None:
        original = dict(DRY_VTYPE)
        apply_to_vtype(DRY_VTYPE, "snow")
        self.assertEqual(DRY_VTYPE, original)

    def test_calibrated_identity_fields_survive(self) -> None:
        out = apply_to_vtype(DRY_VTYPE, "rain")
        self.assertEqual(out["id"], DRY_VTYPE["id"])
        self.assertEqual(out["maxSpeed"], DRY_VTYPE["maxSpeed"])


class TestStoppingDistance(unittest.TestCase):
    def test_stopping_distance_grows_as_conditions_worsen(self) -> None:
        speed = 11.176  # 25 mph
        distances = [stopping_distance_m(speed, w) for w in ["clear", "rain", "storm", "snow"]]
        self.assertEqual(distances, sorted(distances))
        self.assertGreater(distances[-1], distances[0] * 2, "ice must be dramatically worse")


class TestPedestrians(unittest.TestCase):
    def test_bad_weather_reduces_walking(self) -> None:
        for weather in BAD:
            with self.subTest(weather=weather):
                self.assertLess(apply_to_pedestrian_rate(60.0, weather), 60.0)
        self.assertEqual(apply_to_pedestrian_rate(60.0, "clear"), 60.0)


class TestObservedExposure(unittest.TestCase):
    """Frequencies come from the fetched ERA5 data, not from assumptions."""

    def test_january_is_snowier_than_july(self) -> None:
        january = monthly_exposure("fifth-meyran", 1)
        july = monthly_exposure("fifth-meyran", 7)
        if january is None or july is None:
            self.skipTest("weather data not built")
        self.assertGreater(january.snow_share, july.snow_share)
        self.assertEqual(july.snow_share, 0.0)

    def test_weights_form_a_distribution(self) -> None:
        exposure = monthly_exposure("fifth-meyran", 1)
        if exposure is None:
            self.skipTest("weather data not built")
        weights = exposure.weights()
        self.assertAlmostEqual(sum(weights.values()), 1.0, places=6)
        self.assertTrue(all(value >= 0 for value in weights.values()))

    def test_sampling_is_seed_reproducible(self) -> None:
        first = [sample_condition(random.Random(7), "fifth-meyran", 1)[0] for _ in range(5)]
        second = [sample_condition(random.Random(7), "fifth-meyran", 1)[0] for _ in range(5)]
        self.assertEqual(first, second)

    def test_unknown_site_falls_back_to_clear_not_a_guess(self) -> None:
        weather, exposure = sample_condition(random.Random(1), "no-such-site", 6)
        self.assertEqual(weather, DEFAULT_WEATHER)
        self.assertIsNone(exposure)

    def test_month_is_validated(self) -> None:
        with self.assertRaises(ValueError):
            monthly_exposure("fifth-meyran", 13)


class TestScenarioIntegration(unittest.TestCase):
    def test_scenario_rejects_unknown_weather(self) -> None:
        from simulation.interventions import Scenario
        with self.assertRaises(ValueError):
            Scenario("fifth-meyran", weather="hurricane")

    def test_scenario_name_and_dict_carry_weather(self) -> None:
        from simulation.interventions import Scenario
        self.assertEqual(Scenario("fifth-meyran").name, "baseline-osm")
        snowy = Scenario("fifth-meyran", weather="snow")
        self.assertIn("snow", snowy.name)
        self.assertEqual(snowy.to_dict()["weather"]["weather"], "snow")


if __name__ == "__main__":
    unittest.main()
