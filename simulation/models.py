"""Shared data models for SUMO runs, metrics, and safety analysis."""

from __future__ import annotations

import math
import uuid
from dataclasses import asdict, dataclass
from typing import Any


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

    def to_dict(self) -> dict[str, float | str]:
        return {**asdict(self), "average_hourly_traffic": self.average_hourly_traffic}


@dataclass(frozen=True)
class VehicleState:
    vehicle_id: str
    simulation_time_s: float
    x: float
    y: float
    longitude: float
    latitude: float
    speed_mps: float
    acceleration_mps2: float
    angle_degrees: float
    road_id: str
    lane_id: str

    @property
    def velocity(self) -> tuple[float, float]:
        # SUMO angles are clockwise from geographic north.
        angle = math.radians(self.angle_degrees)
        return self.speed_mps * math.sin(angle), self.speed_mps * math.cos(angle)

    @property
    def actor_id(self) -> str:
        return self.vehicle_id

    @property
    def actor_type(self) -> str:
        return "vehicle"


@dataclass(frozen=True)
class PedestrianState:
    pedestrian_id: str
    simulation_time_s: float
    x: float
    y: float
    longitude: float
    latitude: float
    speed_mps: float
    angle_degrees: float
    waiting_time_s: float
    road_id: str

    @property
    def velocity(self) -> tuple[float, float]:
        angle = math.radians(self.angle_degrees)
        return self.speed_mps * math.sin(angle), self.speed_mps * math.cos(angle)

    @property
    def actor_id(self) -> str:
        return self.pedestrian_id

    @property
    def actor_type(self) -> str:
        return "pedestrian"


@dataclass(frozen=True)
class AggregateSample:
    simulation_time_s: float
    mean_speed_mps: float | None
    p95_speed_mps: float | None
    mean_delay_s: float | None
    queue_length: float
    active_vehicle_count: int
    vehicles_completed: int
    active_pedestrian_count: int = 0
    pedestrians_completed: int = 0


@dataclass(frozen=True)
class TTCEvent:
    simulation_time_s: float
    time_to_collision_s: float
    actor_a_id: str
    actor_b_id: str
    x: float
    y: float
    relative_speed_mps: float
    closest_approach_m: float
    relative_position: tuple[float, float]
    relative_velocity: tuple[float, float]
    actor_a_type: str = "vehicle"
    actor_b_type: str = "vehicle"

    def metadata(self, thresholds_s: tuple[float, ...]) -> dict[str, Any]:
        return {
            "closest_approach_m": self.closest_approach_m,
            "relative_position": self.relative_position,
            "relative_velocity": self.relative_velocity,
            "thresholds_met_s": [
                threshold for threshold in thresholds_s if self.time_to_collision_s < threshold
            ],
        }


@dataclass(frozen=True)
class RunMetrics:
    mean_speed_mps: float | None
    median_speed_mps: float | None
    vehicles_completed: int
    throughput_vehicles_per_hour: float
    average_delay_s: float | None
    minimum_ttc_s: float | None
    ttc_event_counts: dict[str, int]
    completed_crossings: int = 0
    mean_pedestrian_wait_s: float | None = None
    p95_pedestrian_wait_s: float | None = None
    vehicle_pedestrian_minimum_ttc_s: float | None = None
    vehicle_pedestrian_ttc_event_counts: dict[str, int] | None = None

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        if result["vehicle_pedestrian_ttc_event_counts"] is None:
            result["vehicle_pedestrian_ttc_event_counts"] = {}
        return result


@dataclass(frozen=True)
class SimulationResult:
    run_id: uuid.UUID
    scenario_name: str
    seed: int
    metrics: RunMetrics

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": str(self.run_id),
            "scenario_name": self.scenario_name,
            "seed": self.seed,
            "metrics": self.metrics.to_dict(),
        }
