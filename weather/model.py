"""Weather conditions for SUMO scenarios.

SUMO has no built-in weather model. Weather is represented here the way traffic
engineers represent it: by changing the *physics and behaviour parameters* of
the vehicles, not by multiplying a risk score afterwards. Each profile scales

    speedFactor      free-flow speed drivers choose
    decel            comfortable deceleration
    emergencyDecel   the physical friction limit  <-- the safety mechanism
    apparentDecel    what FOLLOWERS assume a leader can do
    sigma            driver imperfection
    minGap / tau     following distance and headway

The safety result is emergent rather than asserted. SUMO's default Krauss
car-following model is collision-free by construction, so weather does not
"cause crashes" here, and this module does not claim it does. What changes is
the *stopping distance*: at 25 mph a vehicle needs roughly 19 m to stop on a
dry road and over 50 m on ice. A driver who cannot stop short of the crosswalk
or the stop line is in conflict with whoever is already there, so
`simulation.safety.detect_ttc_events` sees shorter times-to-collision against
pedestrians and crossing traffic. Combined with higher `sigma` (more erratic
speed choice) and longer `tau`, the TTC distribution shifts because the vehicle
dynamics changed, not because a coefficient was applied to the output.

What this is NOT: a model of skidding, loss of control, or reduced visibility
affecting driver perception. Those are the dominant real-world winter crash
mechanisms and SUMO does not represent them.

Two sources of numbers, kept deliberately separate:

* **Behaviour multipliers** are literature-derived defaults (Highway Capacity
  Manual weather adjustment factors for speed and saturation flow; standard
  tyre-road friction coefficients for the deceleration limits). They are
  assumptions, and `provenance` says so on every profile.
* **How often each condition actually occurs** comes from real observations —
  `weather/data/weather_daily.csv`, built from ERA5 reanalysis for these exact
  intersections over 2019-2025. That is what `sample_condition` uses, so a
  Monte Carlo campaign can reproduce a *typical January at Fifth and Meyran*
  (34% snow, 19% rain, 79% of days with a freezing low) rather than an
  invented mix.

Known limitation of the observed mix: ERA5's daily weather code for this
location never reports thunderstorm (WMO 95-99) or fog (45-48), because those
are short sub-daily events that a daily aggregate smooths away. `storm` is
therefore never drawn by `sample_condition`; it remains available as an
explicit scenario condition for the game's "Thunderstorm at rush hour"
challenge. Detecting storms would need the hourly ERA5 endpoint.
"""

from __future__ import annotations

import csv
import random
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

WEATHER_DIR = Path(__file__).resolve().parent
DAILY_WEATHER_CSV = WEATHER_DIR / "data" / "weather_daily.csv"

LITERATURE = (
    "Speed and capacity scales follow Highway Capacity Manual weather "
    "adjustment factor ranges; deceleration scales follow standard tyre-road "
    "friction coefficients (dry ~0.8, wet ~0.5, snow/ice ~0.2). Illustrative "
    "engineering assumptions, not Pittsburgh-calibrated values."
)


@dataclass(frozen=True)
class WeatherProfile:
    """How one weather condition changes driver and vehicle behaviour."""

    id: str
    label: str
    speed_factor_scale: float
    capacity_scale: float
    decel_scale: float
    emergency_decel_scale: float
    sigma_add: float
    min_gap_scale: float
    tau_scale: float
    friction_coefficient: float
    pedestrian_scale: float
    provenance: str = LITERATURE

    def to_dict(self) -> dict[str, float | str]:
        return {
            "weather": self.id,
            "label": self.label,
            "speed_factor_scale": self.speed_factor_scale,
            "capacity_scale": self.capacity_scale,
            "decel_scale": self.decel_scale,
            "emergency_decel_scale": self.emergency_decel_scale,
            "friction_coefficient": self.friction_coefficient,
            "pedestrian_scale": self.pedestrian_scale,
            "provenance": self.provenance,
        }


# Ids match frontend/src/scenarios.js so the game and the backend agree.
WEATHER_PROFILES: dict[str, WeatherProfile] = {
    "clear": WeatherProfile(
        id="clear", label="Clear",
        speed_factor_scale=1.0, capacity_scale=1.0,
        decel_scale=1.0, emergency_decel_scale=1.0,
        sigma_add=0.0, min_gap_scale=1.0, tau_scale=1.0,
        friction_coefficient=1.0, pedestrian_scale=1.0,
        provenance="Reference condition; no adjustment applied.",
    ),
    "rain": WeatherProfile(
        id="rain", label="Rain",
        speed_factor_scale=0.93, capacity_scale=0.90,
        decel_scale=0.85, emergency_decel_scale=0.60,
        sigma_add=0.05, min_gap_scale=1.10, tau_scale=1.10,
        friction_coefficient=0.60, pedestrian_scale=0.75,
    ),
    "storm": WeatherProfile(
        id="storm", label="Thunderstorm",
        speed_factor_scale=0.85, capacity_scale=0.84,
        decel_scale=0.75, emergency_decel_scale=0.50,
        sigma_add=0.10, min_gap_scale=1.20, tau_scale=1.20,
        friction_coefficient=0.50, pedestrian_scale=0.45,
    ),
    "snow": WeatherProfile(
        id="snow", label="Snow / icy roads",
        speed_factor_scale=0.75, capacity_scale=0.76,
        decel_scale=0.45, emergency_decel_scale=0.25,
        sigma_add=0.15, min_gap_scale=1.35, tau_scale=1.35,
        friction_coefficient=0.25, pedestrian_scale=0.60,
    ),
}

DEFAULT_WEATHER = "clear"


def get_profile(weather: str | WeatherProfile | None) -> WeatherProfile:
    """Resolve a weather id to its profile. Unknown ids raise."""
    if isinstance(weather, WeatherProfile):
        return weather
    # None means "unspecified" and defaults; an empty string is a caller bug.
    key = (DEFAULT_WEATHER if weather is None else weather).strip().lower()
    if key not in WEATHER_PROFILES:
        raise ValueError(
            f"Unknown weather {weather!r}. Expected one of: "
            f"{', '.join(sorted(WEATHER_PROFILES))}"
        )
    return WEATHER_PROFILES[key]


def apply_to_vtype(attributes: dict[str, str], weather: str | WeatherProfile) -> dict[str, str]:
    """Return a copy of a SUMO vType with weather physics applied.

    `decel` is the deceleration drivers choose, `emergencyDecel` the physical
    limit friction allows, and `apparentDecel` what followers assume of the car
    ahead. All three scale together: a driver who has adapted to ice brakes
    gently, cannot brake hard even in an emergency, and expects the same of
    everyone else. SUMO requires `emergencyDecel >= decel`, so the result is
    clamped rather than emitting a vType the simulator would reject.
    """
    profile = get_profile(weather)
    updated = dict(attributes)

    dry_decel = float(updated.get("decel", "4.5"))
    dry_emergency = float(updated.get("emergencyDecel", str(max(9.0, dry_decel * 2))))

    decel = dry_decel * profile.decel_scale
    emergency = max(dry_emergency * profile.emergency_decel_scale, decel)
    updated["decel"] = f"{decel:.3f}"
    updated["emergencyDecel"] = f"{emergency:.3f}"
    updated["apparentDecel"] = f"{decel:.3f}"

    if "speedFactor" in updated:
        updated["speedFactor"] = f"{float(updated['speedFactor']) * profile.speed_factor_scale:.3f}"
    if "minGap" in updated:
        updated["minGap"] = f"{float(updated['minGap']) * profile.min_gap_scale:.3f}"
    updated["tau"] = f"{float(updated.get('tau', '1.0')) * profile.tau_scale:.3f}"
    updated["sigma"] = f"{min(1.0, float(updated.get('sigma', '0.5')) + profile.sigma_add):.3f}"

    # Consumed by car-following models that read road friction (for example
    # EIDM). Krauss ignores it, so it is recorded rather than relied upon.
    updated["frictionCoefficient"] = f"{profile.friction_coefficient:.2f}"
    return updated


def apply_to_pedestrian_rate(rate_per_hour: float, weather: str | WeatherProfile) -> float:
    """Fewer people walk in bad weather, which changes conflict exposure."""
    return max(0.0, rate_per_hour * get_profile(weather).pedestrian_scale)


def stopping_distance_m(speed_mps: float, weather: str | WeatherProfile,
                        dry_emergency_decel: float = 9.0,
                        reaction_s: float = 1.0) -> float:
    """Reaction distance plus braking distance under a weather profile.

    Exposed because it is the clearest way to show what weather does: at the
    same speed, the car needs materially more room to stop.
    """
    profile = get_profile(weather)
    decel = dry_emergency_decel * profile.emergency_decel_scale
    return speed_mps * reaction_s + (speed_mps ** 2) / (2 * decel)


# --- Observed frequency, from the fetched ERA5 data ------------------------


@dataclass(frozen=True)
class MonthlyExposure:
    """Observed share of days by condition for one site and calendar month.

    Counts are a true partition: every observed day is classified into exactly
    one condition, so the shares sum to 1. Deriving them by subtracting a
    "snow days" share from a "wet days" share would be wrong, because those two
    flags are measured on different variables (snowfall and rainfall) and a
    January day can trip both or neither.
    """

    site_id: str
    month: int
    days: int
    counts: dict[str, int]
    freezing_share: float

    def weights(self) -> dict[str, float]:
        """Condition probabilities for Monte Carlo sampling."""
        return {name: count / self.days for name, count in self.counts.items()}

    @property
    def snow_share(self) -> float:
        return self.counts.get("snow", 0) / self.days

    @property
    def wet_share(self) -> float:
        return (
            self.counts.get("rain", 0) + self.counts.get("storm", 0)
        ) / self.days


def _classify_day(row: dict[str, str]) -> str:
    """Assign one observed day to exactly one simulated condition.

    Snow wins over rain because icy roads dominate the driving task, and the
    reported WMO group decides thunderstorms.
    """
    if int(row["is_snow_day"]):
        return "snow"
    if row["weather_group"] == "storm":
        return "storm"
    if int(row["is_wet_day"]):
        return "rain"
    return "clear"


@lru_cache(maxsize=1)
def _load_daily_rows() -> tuple[dict[str, str], ...]:
    if not DAILY_WEATHER_CSV.exists():
        return ()
    with DAILY_WEATHER_CSV.open(encoding="utf-8") as handle:
        return tuple(csv.DictReader(handle))


def monthly_exposure(intersection_id: str, month: int) -> MonthlyExposure | None:
    """Observed conditions for one site and month, or None if not fetched.

    Returns None rather than a guess when the weather data has not been built,
    so callers fall back to an explicit condition instead of silently
    simulating invented weather.
    """
    if not 1 <= month <= 12:
        raise ValueError("month must be 1-12")
    rows = [
        row
        for row in _load_daily_rows()
        if row["site_id"] == intersection_id and int(row["month"]) == month
    ]
    if not rows:
        return None
    counts = {name: 0 for name in WEATHER_PROFILES}
    freezing = 0
    for row in rows:
        counts[_classify_day(row)] += 1
        freezing += int(row["is_freezing_day"])
    return MonthlyExposure(
        site_id=intersection_id,
        month=month,
        days=len(rows),
        counts=counts,
        freezing_share=freezing / len(rows),
    )


def sample_condition(
    randomizer: random.Random, intersection_id: str, month: int
) -> tuple[str, MonthlyExposure | None]:
    """Draw one weather condition at this site's observed frequency.

    This is how the fetched data enters the simulation: a Monte Carlo campaign
    over a real January at Fifth and Meyran sees snow roughly a third of the
    time because that is what ERA5 recorded there, not because anyone chose it.
    Falls back to clear when the weather data has not been built.
    """
    exposure = monthly_exposure(intersection_id, month)
    if exposure is None:
        return DEFAULT_WEATHER, None
    weights = exposure.weights()
    conditions = list(weights)
    return (
        randomizer.choices(conditions, weights=[weights[c] for c in conditions], k=1)[0],
        exposure,
    )
