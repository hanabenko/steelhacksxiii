"""Run one calibrated SUMO baseline and persist telemetry to Tiger Data."""

from __future__ import annotations

import argparse
import math
import os
import random
import shutil
import sys
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import traci
from psycopg.types.json import Jsonb
from sumolib.net import readNet

from scripts.tiger import connection
from simulation.network import ensure_network, sumo_binary

OUTPUT_ROOT = REPO_ROOT / "simulation" / "output"
MPH_TO_MPS = 0.44704


@dataclass(frozen=True)
class Calibration:
    source_record_id: str
    average_daily_traffic: float
    median_speed_mph: float
    p85_speed_mph: float
    speed_limit_mph: float

    @property
    def average_hourly_traffic(self) -> float:
        return self.average_daily_traffic / 24.0

    def as_dict(self) -> dict[str, float | str]:
        return {
            "source_record_id": self.source_record_id,
            "average_daily_traffic": self.average_daily_traffic,
            "average_hourly_traffic": self.average_hourly_traffic,
            "median_speed_mph": self.median_speed_mph,
            "p85_speed_mph": self.p85_speed_mph,
            "speed_limit_mph": self.speed_limit_mph,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--intersection", default="fifth-meyran")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--duration", type=int, default=3600, help="Simulation seconds")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--gui", action="store_true", help="Run sumo-gui instead of sumo")
    parser.add_argument("--rebuild-network", action="store_true")
    parser.add_argument("--keep-output", action="store_true")
    return parser.parse_args()


def load_calibration(conn: Any, intersection_id: str) -> Calibration:
    row = conn.execute(
        """
        SELECT source_record_id, average_daily_car_traffic, median_speed_mph,
               p85_speed_mph, speed_limit_mph
        FROM traffic_observations
        WHERE intersection_id = %s
          AND average_daily_car_traffic IS NOT NULL
          AND median_speed_mph IS NOT NULL
          AND p85_speed_mph IS NOT NULL
          AND speed_limit_mph IS NOT NULL
        ORDER BY observed_at DESC
        LIMIT 1
        """,
        (intersection_id,),
    ).fetchone()
    if not row:
        raise RuntimeError(f"No complete traffic calibration record for {intersection_id}")
    return Calibration(
        source_record_id=row["source_record_id"],
        average_daily_traffic=float(row["average_daily_car_traffic"]),
        median_speed_mph=float(row["median_speed_mph"]),
        p85_speed_mph=float(row["p85_speed_mph"]),
        speed_limit_mph=float(row["speed_limit_mph"]),
    )


def target_node_and_routes(
    net_path: Path,
    longitude: float,
    latitude: float,
    street_names: tuple[str, ...] = (),
) -> tuple[str, list[list[str]]]:
    net = readNet(str(net_path), withInternal=True)
    target_x, target_y = net.convertLonLat2XY(longitude, latitude)
    nodes = [node for node in net.getNodes() if not node.getID().startswith(":")]
    required_names = {name.casefold() for name in street_names}
    named_nodes = []
    for node in nodes:
        edge_names = {
            edge.getName().casefold()
            for edge in (*node.getIncoming(), *node.getOutgoing())
            if not edge.isSpecial() and edge.getName()
        }
        if required_names.issubset(edge_names):
            named_nodes.append(node)
    candidates = named_nodes or nodes
    target = min(
        candidates,
        key=lambda node: math.dist(node.getCoord(), (target_x, target_y)),
    )
    routes: list[list[str]] = []
    for incoming in target.getIncoming():
        if incoming.isSpecial():
            continue
        for outgoing in target.getOutgoing():
            if outgoing.isSpecial() or incoming.getFromNode() == outgoing.getToNode():
                continue
            if incoming.getConnections(outgoing):
                routes.append([incoming.getID(), outgoing.getID()])
    if not routes:
        raise RuntimeError(f"No drivable routes cross SUMO junction {target.getID()}")
    return target.getID(), sorted(routes)


def write_routes(
    destination: Path,
    routes: list[list[str]],
    calibration: Calibration,
    duration_s: int,
    seed: int,
) -> int:
    randomizer = random.Random(seed)
    vehicle_count = max(1, round(calibration.average_hourly_traffic * duration_s / 3600))
    root = ET.Element("routes")
    median_factor = calibration.median_speed_mph / calibration.speed_limit_mph
    speed_deviation = max(
        0.05,
        (calibration.p85_speed_mph - calibration.median_speed_mph)
        / calibration.speed_limit_mph,
    )
    ET.SubElement(
        root,
        "vType",
        {
            "id": "calibrated_passenger",
            "vClass": "passenger",
            "accel": "2.6",
            "decel": "4.5",
            "sigma": "0.5",
            "length": "5.0",
            "minGap": "2.5",
            "maxSpeed": f"{calibration.speed_limit_mph * MPH_TO_MPS:.3f}",
            "speedFactor": f"{median_factor:.3f}",
            "speedDev": f"{speed_deviation:.3f}",
        },
    )
    for index, edges in enumerate(routes):
        ET.SubElement(root, "route", {"id": f"crossing_{index}", "edges": " ".join(edges)})
    last_departure = max(0, duration_s - 120)
    spacing = last_departure / vehicle_count if vehicle_count else 0
    for index in range(vehicle_count):
        departure = min(last_departure, index * spacing + randomizer.uniform(0, min(10, spacing)))
        route_index = randomizer.randrange(len(routes))
        ET.SubElement(
            root,
            "vehicle",
            {
                "id": f"baseline_{index:04d}",
                "type": "calibrated_passenger",
                "route": f"crossing_{route_index}",
                "depart": f"{departure:.1f}",
                "departLane": "best",
                "departSpeed": "max",
            },
        )
    ET.indent(root)
    ET.ElementTree(root).write(destination, encoding="utf-8", xml_declaration=True)
    return vehicle_count


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def create_run(
    conn: Any,
    run_id: uuid.UUID,
    intersection_id: str,
    seed: int,
    started_at: datetime,
    config: dict[str, Any],
) -> None:
    conn.execute(
        """
        INSERT INTO simulation_runs (
            run_id, intersection_id, scenario_name, random_seed, status,
            started_at, intervention_config, simulation_config
        ) VALUES (%s, %s, 'baseline-osm', %s, 'running', %s, %s, %s)
        """,
        (run_id, intersection_id, seed, started_at, Jsonb({}), Jsonb(config)),
    )
    conn.commit()


def persist_results(
    conn: Any,
    run_id: uuid.UUID,
    samples: list[tuple[Any, ...]],
    vehicle_states: list[tuple[Any, ...]],
    completed_at: datetime,
) -> None:
    with conn.transaction():
        conn.cursor().executemany(
            """
            INSERT INTO simulation_samples (
                simulated_at, run_id, intersection_id, simulation_time_s,
                mean_speed_mps, p95_speed_mps, mean_delay_s, mean_queue_length,
                active_vehicle_count, active_pedestrian_count,
                vehicles_completed, pedestrians_completed
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            samples,
        )
        conn.cursor().executemany(
            """
            INSERT INTO vehicle_states (
                observed_at, run_id, intersection_id, vehicle_id,
                simulation_time_s, x, y, longitude, latitude,
                speed_mps, acceleration_mps2, road_id, lane_id
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            vehicle_states,
        )
        conn.execute(
            """
            UPDATE simulation_runs
            SET status = 'completed', completed_at = %s
            WHERE run_id = %s
            """,
            (completed_at, run_id),
        )


def mark_failed(conn: Any, run_id: uuid.UUID) -> None:
    conn.execute(
        "UPDATE simulation_runs SET status = 'failed', completed_at = now() WHERE run_id = %s",
        (run_id,),
    )
    conn.commit()


def run_simulation(args: argparse.Namespace) -> uuid.UUID:
    if args.duration < 1:
        raise ValueError("--duration must be at least 1 second")
    spec = ensure_network(args.intersection, force=args.rebuild_network)
    run_id = uuid.uuid4()
    run_directory = OUTPUT_ROOT / str(run_id)
    run_directory.mkdir(parents=True, exist_ok=False)
    route_path = run_directory / "baseline.rou.xml"
    started_at = datetime.now(UTC).replace(microsecond=0)

    with connection(args.database_url) as conn:
        calibration = load_calibration(conn, args.intersection)
        target_node, routes = target_node_and_routes(
            spec.net_path, spec.longitude, spec.latitude, spec.street_names
        )
        planned_vehicles = write_routes(
            route_path, routes, calibration, args.duration, args.seed
        )
        config = {
            "duration_s": args.duration,
            "step_length_s": 1,
            "network_source": "OpenStreetMap",
            "network_path": str(spec.net_path.relative_to(REPO_ROOT)),
            "target_sumo_junction": target_node,
            "crossing_route_count": len(routes),
            "planned_vehicle_count": planned_vehicles,
            "calibration": calibration.as_dict(),
        }
        create_run(conn, run_id, args.intersection, args.seed, started_at, config)
        samples: list[tuple[Any, ...]] = []
        states: list[tuple[Any, ...]] = []
        command = [
            sumo_binary("sumo-gui" if args.gui else "sumo"),
            "--net-file",
            str(spec.net_path),
            "--route-files",
            str(route_path),
            "--seed",
            str(args.seed),
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
            for _ in range(args.duration):
                traci.simulationStep()
                simulation_time = float(traci.simulation.getTime())
                observed_at = started_at + timedelta(seconds=simulation_time)
                vehicle_ids = list(traci.vehicle.getIDList())
                speeds: list[float] = []
                delays: list[float] = []
                queue_length = 0
                for vehicle_id in vehicle_ids:
                    x, y = traci.vehicle.getPosition(vehicle_id)
                    longitude, latitude = traci.simulation.convertGeo(x, y)
                    speed = float(traci.vehicle.getSpeed(vehicle_id))
                    acceleration = float(traci.vehicle.getAcceleration(vehicle_id))
                    speeds.append(speed)
                    delays.append(float(traci.vehicle.getTimeLoss(vehicle_id)))
                    queue_length += int(speed < 0.1)
                    states.append(
                        (
                            observed_at,
                            run_id,
                            args.intersection,
                            vehicle_id,
                            simulation_time,
                            x,
                            y,
                            longitude,
                            latitude,
                            speed,
                            acceleration,
                            traci.vehicle.getRoadID(vehicle_id),
                            traci.vehicle.getLaneID(vehicle_id),
                        )
                    )
                samples.append(
                    (
                        observed_at,
                        run_id,
                        args.intersection,
                        simulation_time,
                        sum(speeds) / len(speeds) if speeds else None,
                        percentile(speeds, 0.95),
                        sum(delays) / len(delays) if delays else None,
                        float(queue_length),
                        len(vehicle_ids),
                        0,
                        int(traci.simulation.getArrivedNumber()),
                        0,
                    )
                )
            persist_results(conn, run_id, samples, states, datetime.now(UTC))
        except Exception:
            mark_failed(conn, run_id)
            raise
        finally:
            if traci.isLoaded():
                traci.close()

    if not args.keep_output:
        shutil.rmtree(run_directory)
    print(
        f"completed run_id={run_id} samples={len(samples)} "
        f"vehicle_states={len(states)} planned_vehicles={planned_vehicles}"
    )
    return run_id


def main() -> int:
    args = parse_args()
    try:
        run_simulation(args)
    except (RuntimeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
