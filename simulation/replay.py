"""Frontend-neutral replay capture and reconstruction helpers."""

from __future__ import annotations

import gzip
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

from simulation.models import PedestrianState


def pedestrian_agent(state: PedestrianState) -> dict[str, Any]:
    return {
        "t": state.simulation_time_s,
        "id": state.pedestrian_id,
        "type": "pedestrian",
        "x": state.x,
        "y": state.y,
        "longitude": state.longitude,
        "latitude": state.latitude,
        "heading": state.angle_degrees,
        "speed_mps": state.speed_mps,
    }


def write_pedestrian_replay(
    destination: Path,
    duration_s: int,
    states: list[dict[str, Any]],
) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    with gzip.open(temporary, "wt", encoding="utf-8") as handle:
        json.dump({"duration_s": duration_s, "states": states}, handle)
    temporary.replace(destination)
    return destination


def read_pedestrian_replay(path: Path | None) -> list[dict[str, Any]]:
    if path is None or not path.exists():
        return []
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return list(json.load(handle)["states"])


def _headings_by_vehicle(rows: list[dict[str, Any]]) -> dict[tuple[str, float], float]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row["vehicle_id"])].append(row)
    headings = {}
    for vehicle_id, vehicle_rows in grouped.items():
        ordered = sorted(vehicle_rows, key=lambda row: float(row["simulation_time_s"]))
        for index, row in enumerate(ordered):
            neighbor = None
            if index + 1 < len(ordered):
                neighbor = ordered[index + 1]
            elif index:
                neighbor = ordered[index - 1]
            dx = float(neighbor["x"]) - float(row["x"]) if neighbor else 0.0
            dy = float(neighbor["y"]) - float(row["y"]) if neighbor else 0.0
            if index and index + 1 == len(ordered):
                dx, dy = -dx, -dy
            heading = math.degrees(math.atan2(dx, dy)) % 360 if dx or dy else 0.0
            headings[(vehicle_id, float(row["simulation_time_s"]))] = heading
    return headings


def build_replay_payload(
    duration_s: int,
    frame_times: list[float],
    vehicle_rows: list[dict[str, Any]],
    pedestrian_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Merge persisted vehicles and captured pedestrians into plain replay frames."""
    agents_by_time: dict[float, list[dict[str, Any]]] = defaultdict(list)
    headings = _headings_by_vehicle(vehicle_rows)
    for row in vehicle_rows:
        time_s = float(row["simulation_time_s"])
        vehicle_id = str(row["vehicle_id"])
        agents_by_time[time_s].append(
            {
                "id": vehicle_id,
                "type": "vehicle",
                "x": float(row["x"]),
                "y": float(row["y"]),
                "longitude": (
                    float(row["longitude"]) if row["longitude"] is not None else None
                ),
                "latitude": (
                    float(row["latitude"]) if row["latitude"] is not None else None
                ),
                "heading": headings[(vehicle_id, time_s)],
                "speed_mps": float(row["speed_mps"]),
            }
        )
    for row in pedestrian_rows:
        time_s = float(row["t"])
        agents_by_time[time_s].append(
            {
                key: value
                for key, value in row.items()
                if key in {"id", "type", "x", "y", "longitude", "latitude", "heading", "speed_mps"}
            }
        )
    times = sorted(set(frame_times) | set(agents_by_time))
    return {
        "duration_s": duration_s,
        "frames": [
            {
                "t": time_s,
                "agents": sorted(
                    agents_by_time.get(time_s, []),
                    key=lambda agent: (agent["type"], agent["id"]),
                ),
            }
            for time_s in times
        ],
    }
