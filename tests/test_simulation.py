from __future__ import annotations

import json
import uuid
import xml.etree.ElementTree as ET
from types import SimpleNamespace

import pytest

from simulation.api import compare_scenario_configs, simulate_scenario
from simulation.compare import compare_scenarios
from simulation.demand import PedestrianDemandConfig, write_routes
from simulation.interventions import Scenario, SignalTimingChange, SpeedLimitChange
from simulation.metrics import aggregate_run_metrics, calculate_run_metrics, percentile
from simulation.models import (
    Calibration,
    PedestrianState,
    RunMetrics,
    SimulationResult,
    TTCEvent,
    VehicleState,
)
from simulation.monte_carlo import derive_run_seeds
from simulation.network import NETWORKS, bounding_box, target_node_and_routes
from simulation.safety import (
    SafetyConfig,
    calculate_ttc,
    detect_ttc_events,
    minimum_ttc_events,
)
from simulation.signals import phase_duration_overrides


def state(
    vehicle_id: str,
    x: float,
    y: float,
    speed: float,
    angle: float,
) -> VehicleState:
    return VehicleState(
        vehicle_id=vehicle_id,
        simulation_time_s=1.0,
        x=x,
        y=y,
        longitude=0.0,
        latitude=0.0,
        speed_mps=speed,
        acceleration_mps2=0.0,
        angle_degrees=angle,
        road_id="edge",
        lane_id="edge_0",
    )


def test_head_on_convergence() -> None:
    result = calculate_ttc(
        state("a", 0, 0, 5, 90),
        state("b", 10, 0, 5, 270),
        collision_distance_m=2,
    )

    assert result is not None
    assert result.time_to_collision_s == pytest.approx(0.8)
    assert result.closest_approach_m == pytest.approx(0)


def test_rear_end_convergence() -> None:
    result = calculate_ttc(
        state("following", 0, 0, 5, 90),
        state("leading", 10, 0, 2, 90),
        collision_distance_m=2,
    )

    assert result is not None
    assert result.time_to_collision_s == pytest.approx(8 / 3)


def test_diverging_vehicles_are_ignored() -> None:
    assert (
        calculate_ttc(
            state("a", 0, 0, 5, 270),
            state("b", 10, 0, 5, 90),
        )
        is None
    )

    assert (
        calculate_ttc(
            state("a", 0, 0, 5, 270),
            state("b", 1, 0, 5, 90),
            collision_distance_m=2,
        )
        is None
    )


def test_stationary_vehicles_are_ignored() -> None:
    assert calculate_ttc(state("a", 0, 0, 0, 0), state("b", 5, 0, 0, 0)) is None


def test_parallel_non_conflicting_vehicles_are_ignored() -> None:
    assert (
        calculate_ttc(
            state("a", 0, 0, 5, 90),
            state("b", 0, 10, 3, 90),
            collision_distance_m=2,
        )
        is None
    )


def test_ttc_thresholds_are_configurable() -> None:
    config = SafetyConfig(ttc_thresholds_s=(1.0, 2.0), collision_distance_m=2)
    events = detect_ttc_events(
        [state("a", 0, 0, 5, 90), state("b", 10, 0, 5, 270)],
        config,
    )

    assert len(events) == 1
    assert events[0].metadata(config.ttc_thresholds_s)["thresholds_met_s"] == [1.0, 2.0]


def test_minimum_ttc_event_is_kept_per_vehicle_pair() -> None:
    events = [
        TTCEvent(1, 1.2, "a", "b", 5, 0, 10, 0, (10, 0), (-10, 0)),
        TTCEvent(2, 0.8, "b", "a", 5, 0, 10, 0, (-8, 0), (10, 0)),
    ]

    result = minimum_ttc_events(events)

    assert len(result) == 1
    assert result[0].time_to_collision_s == pytest.approx(0.8)


def test_run_metrics_and_distributions() -> None:
    event = TTCEvent(1, 0.8, "a", "b", 5, 0, 10, 0, (10, 0), (-10, 0))
    metrics = calculate_run_metrics(
        speeds_mps=[2, 4, 6],
        vehicles_completed=3,
        duration_s=600,
        vehicle_delays_s=[1, 3],
        ttc_events=[event],
        thresholds_s=(1.0, 3.0),
    )
    aggregate = aggregate_run_metrics([metrics, metrics], (1.0, 3.0))

    assert metrics.mean_speed_mps == 4
    assert metrics.median_speed_mps == 4
    assert metrics.throughput_vehicles_per_hour == 18
    assert metrics.average_delay_s == 2
    assert metrics.minimum_ttc_s == 0.8
    assert metrics.ttc_event_counts == {"1": 1, "3": 1}
    assert aggregate["metrics"]["mean_speed_mps"]["stddev"] == 0
    assert aggregate["ttc_thresholds_s"]["1"]["proportion_of_runs_with_event"] == 1


def test_fifth_meyran_network_targets_named_intersection() -> None:
    node_id, routes = target_node_and_routes(NETWORKS["fifth-meyran"])

    assert node_id == "cluster_104580895_8099223724"
    assert len(routes) == 3
    assert all(len(route) == 2 for route in routes)


def test_route_demand_is_deterministic_and_intervention_changes_limit(tmp_path) -> None:
    calibration = Calibration("428229895", 382, 16, 20, 25)
    baseline_path = tmp_path / "baseline.rou.xml"
    repeat_path = tmp_path / "repeat.rou.xml"
    modified_path = tmp_path / "modified.rou.xml"
    baseline = Scenario("fifth-meyran", [])
    modified = Scenario("fifth-meyran", [SpeedLimitChange(20)])

    baseline_plan = write_routes(
        baseline_path, [["in", "out"]], [], calibration, baseline, 600, 42
    )
    repeat_plan = write_routes(
        repeat_path, [["in", "out"]], [], calibration, baseline, 600, 42
    )
    write_routes(modified_path, [["in", "out"]], [], calibration, modified, 600, 42)

    assert baseline_plan == repeat_plan
    baseline_root = ET.parse(baseline_path).getroot()
    repeat_root = ET.parse(repeat_path).getroot()
    modified_root = ET.parse(modified_path).getroot()
    assert [item.attrib for item in baseline_root.findall("vehicle")] == [
        item.attrib for item in repeat_root.findall("vehicle")
    ]
    assert baseline_root.find("vType").attrib["maxSpeed"] == "11.176"
    assert baseline_root.find("vType").attrib["speedFactor"] == "0.640"
    assert modified_root.find("vType").attrib["maxSpeed"] == "8.941"
    assert modified_root.find("vType").attrib["speedFactor"] == "0.512"


def test_monte_carlo_seeds_are_deterministic_and_unique() -> None:
    assert derive_run_seeds(42, 5) == derive_run_seeds(42, 5)
    assert len(set(derive_run_seeds(42, 100))) == 100


def test_scenario_comparison_uses_matched_seeds() -> None:
    calls: list[tuple[str, int]] = []

    def fake_runner(**kwargs) -> SimulationResult:
        scenario = kwargs["scenario"]
        seed = kwargs["seed"]
        calls.append((scenario.name, seed))
        speed = 5.0 if not scenario.interventions else 4.0
        pedestrian_wait = 8.0 if not scenario.interventions else 5.0
        return SimulationResult(
            run_id=uuid.uuid5(uuid.NAMESPACE_URL, f"{scenario.name}:{seed}"),
            scenario_name=scenario.name,
            seed=seed,
            metrics=RunMetrics(
                speed,
                speed,
                10,
                60,
                2,
                None,
                {"1.5": 0, "3": 0},
                completed_crossings=4,
                mean_pedestrian_wait_s=pedestrian_wait,
                p95_pedestrian_wait_s=pedestrian_wait + 2,
                vehicle_pedestrian_ttc_event_counts={"1.5": 0, "3": 1},
            ),
        )

    result = compare_scenarios(
        baseline=Scenario("fifth-meyran", []),
        intervention=Scenario("fifth-meyran", [SpeedLimitChange(20)]),
        runs=3,
        base_seed=42,
        database_url=None,
        duration_s=600,
        runner=fake_runner,
    )

    baseline_seeds = [seed for name, seed in calls if name == "baseline-osm"]
    intervention_seeds = [seed for name, seed in calls if name != "baseline-osm"]
    assert baseline_seeds == intervention_seeds
    assert result["delta"]["mean_speed_mps"] == -1
    assert result["delta"]["mean_pedestrian_wait_s"] == -3


def test_signal_timing_targets_principal_green_phases() -> None:
    phases = [
        SimpleNamespace(duration=32, state="GGGGrr"),
        SimpleNamespace(duration=3, state="yyyyrr"),
        SimpleNamespace(duration=28, state="rrrrGG"),
        SimpleNamespace(duration=5, state="rrrrrr"),
    ]

    overrides = phase_duration_overrides(phases, SignalTimingChange(40, 20))

    assert overrides == {0: 40, 2: 20}


def test_pedestrian_generation_is_deterministic(tmp_path) -> None:
    calibration = Calibration("428229895", 382, 16, 20, 25)
    first = tmp_path / "first.rou.xml"
    second = tmp_path / "second.rou.xml"
    args = (
        [["in", "out"]],
        [("walk-in", "walk-out")],
        calibration,
        Scenario("fifth-meyran"),
        600,
        42,
        PedestrianDemandConfig(pedestrians_per_hour=60),
    )

    write_routes(first, *args)
    write_routes(second, *args)

    assert first.read_text() == second.read_text()
    assert ET.parse(first).getroot().find("person/walk") is not None


def test_vehicle_pedestrian_ttc_is_separate_and_typed() -> None:
    vehicle = state("car", 0, 0, 5, 90)
    pedestrian = PedestrianState(
        pedestrian_id="walker",
        simulation_time_s=1,
        x=10,
        y=0,
        longitude=0,
        latitude=0,
        speed_mps=1,
        angle_degrees=270,
        waiting_time_s=0,
        road_id=":crossing",
    )

    events = detect_ttc_events(
        [vehicle], SafetyConfig(ttc_thresholds_s=(3.0,)), [pedestrian]
    )

    assert len(events) == 1
    assert (events[0].actor_a_type, events[0].actor_b_type) == (
        "vehicle",
        "pedestrian",
    )


def test_public_simulation_result_is_json_serializable() -> None:
    def fake_runner(**kwargs) -> SimulationResult:
        return SimulationResult(
            run_id=uuid.uuid4(),
            scenario_name=kwargs["scenario"].name,
            seed=kwargs["seed"],
            metrics=RunMetrics(
                4,
                4,
                3,
                18,
                2,
                None,
                {"1.5": 0, "3": 0},
                completed_crossings=2,
                mean_pedestrian_wait_s=3,
                p95_pedestrian_wait_s=5,
                vehicle_pedestrian_ttc_event_counts={"1.5": 0, "3": 1},
            ),
        )

    result = simulate_scenario(
        interventions=[
            {"type": "signal_timing", "main_green_s": 40, "side_green_s": 25}
        ],
        runs=2,
        runner=fake_runner,
    )

    assert result["number_of_runs"] == 2
    assert len(result["persisted_run_ids"]) == 2
    assert result["scenario"]["interventions"][0]["intervention_type"] == "signal_timing"
    assert result["metrics"]["completed_crossings"]["mean"] == 2
    assert json.loads(json.dumps(result))["schema_version"] == "1.0"

    comparison = compare_scenario_configs(
        "fifth-meyran",
        [],
        [{"type": "signal_timing", "main_green_s": 40, "side_green_s": 25}],
        runs=2,
        runner=fake_runner,
    )
    serialized = json.loads(json.dumps(comparison))
    assert serialized["baseline"]["seeds"] == serialized["intervention"]["seeds"]
    assert "vehicle_pedestrian_low_ttc_events" in serialized["delta"]


def test_percentile_interpolates_and_handles_empty_input() -> None:
    assert percentile([], 0.95) is None
    assert percentile([1.0, 2.0, 3.0], 0.5) == 2.0
    assert percentile([0.0, 10.0], 0.95) == pytest.approx(9.5)


def test_osm_bbox_contains_intersection_center() -> None:
    spec = NETWORKS["fifth-meyran"]
    west, south, east, north = bounding_box(spec)

    assert west < spec.longitude < east
    assert south < spec.latitude < north
