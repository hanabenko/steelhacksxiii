"""Reusable TraCI execution engine for one Interlock scenario."""

from __future__ import annotations

import shutil
import uuid
from datetime import UTC, datetime
from pathlib import Path

import traci

from scripts.tiger import connection
from simulation.database import (
    create_run,
    load_calibration,
    mark_failed,
    persist_results,
)
from simulation.demand import PedestrianDemandConfig, write_routes
from simulation.interventions import Scenario
from simulation.metrics import calculate_run_metrics, percentile
from simulation.models import (
    AggregateSample,
    PedestrianState,
    SimulationResult,
    VehicleState,
)
from simulation.network import ensure_network, sumo_binary, target_network_plan
from simulation.safety import SafetyConfig, detect_ttc_events, minimum_ttc_events
from simulation.signals import apply_signal_interventions

REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = REPO_ROOT / "simulation" / "output"


def run_scenario(
    scenario: Scenario,
    seed: int,
    database_url: str | None,
    duration_s: int = 3600,
    safety_config: SafetyConfig | None = None,
    gui: bool = False,
    rebuild_network: bool = False,
    keep_output: bool = False,
    pedestrian_config: PedestrianDemandConfig | None = None,
) -> SimulationResult:
    """Run and persist one scenario; suitable for CLI, Monte Carlo, or API wrapping."""
    if duration_s < 1:
        raise ValueError("Run duration must be at least one second")
    safety_config = safety_config or SafetyConfig()
    pedestrian_config = pedestrian_config or PedestrianDemandConfig()
    spec = ensure_network(scenario.intersection_id, force=rebuild_network)
    network_plan = target_network_plan(spec)
    run_id = uuid.uuid4()
    run_directory = OUTPUT_ROOT / str(run_id)
    run_directory.mkdir(parents=True, exist_ok=False)
    route_path = run_directory / "scenario.rou.xml"
    started_at = datetime.now(UTC).replace(microsecond=0)

    with connection(database_url) as conn:
        calibration = load_calibration(conn, scenario.intersection_id)
        demand = write_routes(
            route_path,
            [list(route) for route in network_plan.vehicle_routes],
            network_plan.pedestrian_routes,
            calibration,
            scenario,
            duration_s,
            seed,
            pedestrian_config,
        )
        config = {
            "duration_s": duration_s,
            "step_length_s": 1,
            "network_source": "OpenStreetMap",
            "network_path": str(spec.net_path.relative_to(REPO_ROOT)),
            "target_sumo_junction": network_plan.target_node_id,
            "target_traffic_light": network_plan.traffic_light_id,
            "crossing_route_count": len(network_plan.vehicle_routes),
            "pedestrian_crossing_route_count": len(network_plan.pedestrian_routes),
            "calibration": calibration.to_dict(),
            "demand": demand.to_dict(),
            "safety": safety_config.to_dict(),
            "pedestrian_demand_assumption": pedestrian_config.to_dict(),
        }
        create_run(conn, run_id, scenario, seed, started_at, config)
        samples: list[AggregateSample] = []
        states: list[VehicleState] = []
        vehicle_safety_events = []
        vehicle_pedestrian_events = []
        all_speeds: list[float] = []
        latest_vehicle_delays: dict[str, float] = {}
        latest_pedestrian_waits: dict[str, float] = {}
        vehicles_completed = 0
        pedestrians_completed = 0
        command = [
            sumo_binary("sumo-gui" if gui else "sumo"),
            "--net-file",
            str(spec.net_path),
            "--route-files",
            str(route_path),
            "--seed",
            str(seed),
            "--step-length",
            "1",
            "--no-step-log",
            "true",
            "--duration-log.disable",
            "true",
            "--time-to-teleport",
            "120",
        ]
        try:
            traci.start(command)
            apply_signal_interventions(scenario, network_plan.traffic_light_id)
            for _ in range(duration_s):
                traci.simulationStep()
                simulation_time = float(traci.simulation.getTime())
                step_states = []
                step_delays = []
                for vehicle_id in traci.vehicle.getIDList():
                    x, y = traci.vehicle.getPosition(vehicle_id)
                    longitude, latitude = traci.simulation.convertGeo(x, y)
                    state = VehicleState(
                        vehicle_id=vehicle_id,
                        simulation_time_s=simulation_time,
                        x=x,
                        y=y,
                        longitude=longitude,
                        latitude=latitude,
                        speed_mps=float(traci.vehicle.getSpeed(vehicle_id)),
                        acceleration_mps2=float(traci.vehicle.getAcceleration(vehicle_id)),
                        angle_degrees=float(traci.vehicle.getAngle(vehicle_id)),
                        road_id=traci.vehicle.getRoadID(vehicle_id),
                        lane_id=traci.vehicle.getLaneID(vehicle_id),
                    )
                    delay = float(traci.vehicle.getTimeLoss(vehicle_id))
                    latest_vehicle_delays[vehicle_id] = delay
                    step_delays.append(delay)
                    step_states.append(state)
                step_pedestrians = []
                for pedestrian_id in traci.person.getIDList():
                    x, y = traci.person.getPosition(pedestrian_id)
                    longitude, latitude = traci.simulation.convertGeo(x, y)
                    pedestrian_speed = float(traci.person.getSpeed(pedestrian_id))
                    latest_pedestrian_waits.setdefault(pedestrian_id, 0.0)
                    if pedestrian_speed < 0.1:
                        latest_pedestrian_waits[pedestrian_id] += 1.0
                    waiting_time = latest_pedestrian_waits[pedestrian_id]
                    step_pedestrians.append(
                        PedestrianState(
                            pedestrian_id=pedestrian_id,
                            simulation_time_s=simulation_time,
                            x=x,
                            y=y,
                            longitude=longitude,
                            latitude=latitude,
                            speed_mps=pedestrian_speed,
                            angle_degrees=float(traci.person.getAngle(pedestrian_id)),
                            waiting_time_s=waiting_time,
                            road_id=traci.person.getRoadID(pedestrian_id),
                        )
                    )
                step_speeds = [state.speed_mps for state in step_states]
                all_speeds.extend(step_speeds)
                states.extend(step_states)
                vehicle_safety_events.extend(
                    detect_ttc_events(step_states, safety_config)
                )
                vehicle_pedestrian_events.extend(
                    detect_ttc_events(step_states, safety_config, step_pedestrians)
                )
                arrived = int(traci.simulation.getArrivedNumber())
                arrived_pedestrians = int(traci.simulation.getArrivedPersonNumber())
                vehicles_completed += arrived
                pedestrians_completed += arrived_pedestrians
                samples.append(
                    AggregateSample(
                        simulation_time_s=simulation_time,
                        mean_speed_mps=(
                            sum(step_speeds) / len(step_speeds) if step_speeds else None
                        ),
                        p95_speed_mps=percentile(step_speeds, 0.95),
                        mean_delay_s=(
                            sum(step_delays) / len(step_delays) if step_delays else None
                        ),
                        queue_length=float(
                            sum(state.speed_mps < 0.1 for state in step_states)
                        ),
                        active_vehicle_count=len(step_states),
                        vehicles_completed=arrived,
                        active_pedestrian_count=len(step_pedestrians),
                        pedestrians_completed=arrived_pedestrians,
                    )
                )
            vehicle_safety_events = minimum_ttc_events(vehicle_safety_events)
            vehicle_pedestrian_events = minimum_ttc_events(
                vehicle_pedestrian_events
            )
            metrics = calculate_run_metrics(
                speeds_mps=all_speeds,
                vehicles_completed=vehicles_completed,
                duration_s=duration_s,
                vehicle_delays_s=list(latest_vehicle_delays.values()),
                ttc_events=vehicle_safety_events,
                thresholds_s=safety_config.ttc_thresholds_s,
                pedestrians_completed=pedestrians_completed,
                pedestrian_waits_s=list(latest_pedestrian_waits.values()),
                vehicle_pedestrian_events=vehicle_pedestrian_events,
            )
            persist_results(
                conn=conn,
                run_id=run_id,
                intersection_id=scenario.intersection_id,
                started_at=started_at,
                samples=samples,
                vehicle_states=states,
                ttc_events=vehicle_safety_events + vehicle_pedestrian_events,
                safety_config=safety_config,
                metrics=metrics,
                completed_at=datetime.now(UTC),
            )
        except Exception:
            mark_failed(conn, run_id)
            raise
        finally:
            if traci.isLoaded():
                traci.close()

    if not keep_output:
        shutil.rmtree(run_directory)
    return SimulationResult(
        run_id=run_id,
        scenario_name=scenario.name,
        seed=seed,
        metrics=metrics,
    )
