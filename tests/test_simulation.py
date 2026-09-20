from __future__ import annotations

import json
import uuid
import xml.etree.ElementTree as ET
from types import SimpleNamespace

import pytest

import simulation.baseline as baseline_module
from simulation.api import compare_scenario_configs, simulate_scenario
from simulation.baseline import get_baseline_state
from simulation.compare import compare_scenarios
from simulation.demand import PedestrianDemandConfig, write_routes
from simulation.frontend_contract import (
    FRONTEND_INTERSECTION_ID,
    simulate_frontend_scenario,
    validate_frontend_payload,
)
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
from simulation.network import NETWORKS, bounding_box, target_network_plan, target_node_and_routes
from simulation.replay import build_replay_payload
from simulation.representative import select_representative_run
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
    assert aggregate["ttc_thresholds_s"]["1"]["events_per_1000_completed_vehicles"]["mean"] == pytest.approx(1000 / 3)


def test_fifth_meyran_network_targets_named_intersection() -> None:
    node_id, routes = target_node_and_routes(NETWORKS["fifth-meyran"])

    assert node_id == "cluster_104580895_8099223724"
    assert len(routes) == 3
    assert all(len(route) == 2 for route in routes)


def test_frontend_target_has_stable_sumo_junction_and_signal() -> None:
    plan = target_network_plan(NETWORKS[FRONTEND_INTERSECTION_ID])

    assert plan.target_node_id == "cluster_105013345_6715675240_6715675241_6715675242_#1more"
    assert plan.traffic_light_id == plan.target_node_id
    assert plan.vehicle_routes


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


def test_vehicle_demand_override_changes_seeded_arrival_rate(tmp_path) -> None:
    calibration = Calibration("record", 24, 16, 20, 25)
    default = write_routes(
        tmp_path / "default.rou.xml",
        [["in", "out"]],
        [],
        calibration,
        Scenario("fifth-meyran"),
        600,
        42,
    )
    overridden = write_routes(
        tmp_path / "overridden.rou.xml",
        [["in", "out"]],
        [],
        calibration,
        Scenario("fifth-meyran", vehicle_demand_vehicles_per_hour=120),
        600,
        42,
    )

    assert default.average_hourly_traffic == 1
    assert default.demand_source == "traffic_observation"
    assert overridden.average_hourly_traffic == 120
    assert overridden.demand_source == "scenario_override"
    assert overridden.vehicle_count > default.vehicle_count


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


def frontend_state(run_id: str = "frontend-run") -> dict:
    distribution = {
        "mean": 5.0,
        "median": 5.0,
        "stddev": 1.0,
        "p5": 3.0,
        "p25": 4.0,
        "p75": 6.0,
        "p95": 7.0,
    }
    return {
        "aggregate_metrics": {
            "metrics": {
                "mean_speed_mps": distribution,
                "median_speed_mps": distribution,
                "average_delay_s": distribution,
                "throughput_vehicles_per_hour": distribution,
                "vehicles_completed": distribution,
                "completed_crossings": distribution,
                "mean_pedestrian_wait_s": distribution,
                "p95_pedestrian_wait_s": distribution,
            },
            "safety": {
                "vehicle_vehicle": {
                    "1.5": {
                        "event_count": distribution,
                        "events_per_1000_completed_vehicles": distribution,
                        "proportion_of_runs_with_event": 0.5,
                    }
                },
                "vehicle_pedestrian": {
                    "1.5": {
                        "event_count": distribution,
                        "events_per_1000_completed_vehicles": distribution,
                        "proportion_of_runs_with_event": 0.5,
                    }
                },
            },
        },
        "representative_run": {
            "replay": {
                "duration_s": 12,
                "frame_interval_s": 1,
                "coordinate_system": {"canonical": "WGS84 longitude/latitude"},
                "signal_states": [{"t": 1, "signal_id": "tls", "state": "Gr"}],
                "safety_events": [
                    {
                        "t": 2,
                        "type": "ttc_conflict",
                        "category": "vehicle_pedestrian",
                        "ttc_s": 1.2,
                        "agents": ["vehicle_1", "pedestrian_1"],
                        "longitude": -79.95,
                        "latitude": 40.44,
                    }
                ],
                "frames": [
                    {
                        "t": 1,
                        "agents": [
                            {
                                "id": "vehicle_1",
                                "type": "vehicle",
                                "longitude": -79.95,
                                "latitude": 40.44,
                                "heading": 90,
                                "speed_mps": 5,
                            },
                            {
                                "id": "pedestrian_1",
                                "type": "pedestrian",
                                "longitude": -79.95,
                                "latitude": 40.44,
                                "heading": 180,
                                "speed_mps": 1,
                            },
                        ],
                    }
                ],
            }
        },
        "assumptions": {"run_seeds": [11, 12]},
        "persisted_run_ids": [run_id],
    }


def test_frontend_contract_validates_demand_and_smart_signal_translation() -> None:
    config = validate_frontend_payload(
        {
            "schemaVersion": 2,
            "intersection": FRONTEND_INTERSECTION_ID,
            "seed": 9,
            "settings": {"runs": 2, "demand": 400, "green": 30, "av": 0},
            "upgrades": [{"type": "signal", "zone": "north"}],
        }
    )

    assert config["vehicle_demand_vehicles_per_hour"] == 400
    assert config["interventions"] == [
        {
            "type": "signal_timing",
            "main_green_s": 30,
            "side_green_s": 30,
            "frontend_zone": "north",
        }
    ]


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        (
            {"schemaVersion": 2, "intersection": FRONTEND_INTERSECTION_ID, "upgrades": [{"type": "crosswalk"}]},
            "unsupported_intervention",
        ),
        (
            {"schemaVersion": 2, "intersection": FRONTEND_INTERSECTION_ID, "settings": {"av": 10}},
            "unsupported_av_behavior",
        ),
    ],
)
def test_frontend_contract_returns_structured_rejections(payload: dict, code: str) -> None:
    result = simulate_frontend_scenario(payload)

    assert result["contract_version"] == 1
    assert result["error"]["code"] == code


def test_frontend_contract_returns_metrics_replay_and_matched_deltas() -> None:
    calls = []

    def baseline_loader(**kwargs):
        calls.append(("baseline", kwargs))
        return frontend_state("baseline")

    def scenario_loader(**kwargs):
        calls.append(("modified", kwargs))
        state = frontend_state("modified")
        state["aggregate_metrics"]["metrics"]["mean_speed_mps"] = {
            **state["aggregate_metrics"]["metrics"]["mean_speed_mps"],
            "mean": 4.0,
        }
        return state

    result = simulate_frontend_scenario(
        {
            "schemaVersion": 2,
            "intersection": FRONTEND_INTERSECTION_ID,
            "settings": {"runs": 2, "demand": 500, "green": 25, "av": 0},
            "upgrades": [{"type": "signal", "zone": "west"}],
        },
        baseline_loader=baseline_loader,
        scenario_loader=scenario_loader,
    )

    assert [name for name, _ in calls] == ["baseline", "modified"]
    assert calls[0][1]["vehicle_demand_vehicles_per_hour"] == 500
    assert result["baseline"]["metrics"]["mean_speed_mph"]["unit"] == "mph"
    assert result["delta"]["mean_speed_mph"] == pytest.approx(-2.2369362920544)
    replay = result["modified"]["representative_replay"]
    assert replay["coordinate_system"]["canonical"] == "WGS84 longitude/latitude"
    assert {agent["type"] for agent in replay["frames"][0]["agents"]} == {
        "vehicle",
        "pedestrian",
    }
    assert replay["signal_states"] and replay["safety_events"]
    assert json.loads(json.dumps(result))["contract_version"] == 1


def test_osm_bbox_contains_intersection_center() -> None:
    spec = NETWORKS["fifth-meyran"]
    west, south, east, north = bounding_box(spec)

    assert west < spec.longitude < east
    assert south < spec.latitude < north


def representative_run(run_id: str, seed: int, speed: float, delay: float) -> dict:
    return {
        "run_id": run_id,
        "scenario_name": "baseline-osm",
        "seed": seed,
        "metrics": {
            "mean_speed_mps": speed,
            "median_speed_mps": speed,
            "vehicles_completed": 10,
            "throughput_vehicles_per_hour": 10,
            "average_delay_s": delay,
            "completed_crossings": 5,
            "mean_pedestrian_wait_s": 2,
            "p95_pedestrian_wait_s": 4,
            "ttc_event_counts": {"1.5": 0, "3": 1},
            "vehicle_pedestrian_ttc_event_counts": {"1.5": 0, "3": 0},
        },
    }


def test_representative_run_selection_is_deterministic() -> None:
    runs = [
        representative_run("run-high", 30, 8, 8),
        representative_run("run-middle", 20, 5, 5),
        representative_run("run-low", 10, 2, 2),
    ]

    selected = select_representative_run(runs)
    reversed_selection = select_representative_run(list(reversed(runs)))

    assert selected["run"]["run_id"] == "run-middle"
    assert reversed_selection["run"]["run_id"] == "run-middle"
    assert selected["selection"]["distance"] == 0


def test_replay_payload_shape_includes_vehicles_and_pedestrians() -> None:
    replay = build_replay_payload(
        duration_s=2,
        frame_times=[1.0, 2.0],
        vehicle_rows=[
            {
                "vehicle_id": "veh-1",
                "simulation_time_s": 1,
                "x": 0,
                "y": 0,
                "longitude": -79,
                "latitude": 40,
                "speed_mps": 5,
            },
            {
                "vehicle_id": "veh-1",
                "simulation_time_s": 2,
                "x": 5,
                "y": 0,
                "longitude": -78.9,
                "latitude": 40,
                "speed_mps": 5,
            },
        ],
        pedestrian_rows=[
            {
                "t": 1,
                "id": "ped-1",
                "type": "pedestrian",
                "x": 1,
                "y": 2,
                "longitude": -79,
                "latitude": 40,
                "heading": 180,
                "speed_mps": 1.2,
            }
        ],
    )

    assert replay["duration_s"] == 2
    assert replay["frames"][0] == {"t": 0.0, "agents": []}
    assert {agent["type"] for agent in replay["frames"][1]["agents"]} == {
        "vehicle",
        "pedestrian",
    }
    assert set(replay["frames"][1]["agents"][0]) == {
        "id",
        "type",
        "x",
        "y",
        "longitude",
        "latitude",
        "heading",
        "speed_mps",
    }
    json.dumps(replay)


def test_cached_baseline_is_reused_and_force_refreshes(tmp_path, monkeypatch) -> None:
    calls = []

    def fake_generate(**kwargs):
        calls.append(kwargs)
        return {
            "schema_version": "1.0",
            "intersection": {"id": "fifth-meyran"},
            "aggregate_metrics": {"run_count": 1},
            "representative_run": {"run_id": f"run-{len(calls)}", "replay": {}},
            "assumptions": {},
            "persisted_run_ids": [f"run-{len(calls)}"],
        }

    monkeypatch.setattr(baseline_module, "generate_scenario_state", fake_generate)
    first = get_baseline_state(runs=1, duration_s=10, cache_root=tmp_path)
    second = get_baseline_state(runs=1, duration_s=10, cache_root=tmp_path)
    refreshed = get_baseline_state(
        runs=1,
        duration_s=10,
        cache_root=tmp_path,
        force_refresh=True,
    )

    assert len(calls) == 2
    assert second == first
    assert refreshed["representative_run"]["run_id"] == "run-2"
    assert json.loads(json.dumps(first))["intersection"]["id"] == "fifth-meyran"
