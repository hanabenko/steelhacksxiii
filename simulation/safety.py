"""Time-to-collision calculations for vehicle interactions."""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass
from typing import Protocol

from simulation.models import PedestrianState, TTCEvent, VehicleState


class TrafficActor(Protocol):
    actor_id: str
    actor_type: str
    simulation_time_s: float
    x: float
    y: float
    speed_mps: float
    velocity: tuple[float, float]


ActorState = VehicleState | PedestrianState


@dataclass(frozen=True)
class SafetyConfig:
    ttc_thresholds_s: tuple[float, ...] = (1.5, 3.0)
    collision_distance_m: float = 2.5
    max_detection_distance_m: float = 75.0

    def __post_init__(self) -> None:
        thresholds = tuple(sorted(set(self.ttc_thresholds_s)))
        if not thresholds or any(value <= 0 for value in thresholds):
            raise ValueError("TTC thresholds must contain positive values")
        if self.collision_distance_m <= 0:
            raise ValueError("Collision distance must be positive")
        if self.max_detection_distance_m <= self.collision_distance_m:
            raise ValueError("Detection distance must exceed collision distance")
        object.__setattr__(self, "ttc_thresholds_s", thresholds)

    def to_dict(self) -> dict[str, object]:
        return {
            "ttc_thresholds_s": self.ttc_thresholds_s,
            "collision_distance_m": self.collision_distance_m,
            "max_detection_distance_m": self.max_detection_distance_m,
        }


@dataclass(frozen=True)
class TTCComputation:
    time_to_collision_s: float
    closest_approach_m: float
    relative_position: tuple[float, float]
    relative_velocity: tuple[float, float]
    relative_speed_mps: float


def calculate_ttc(
    actor_a: TrafficActor,
    actor_b: TrafficActor,
    collision_distance_m: float = 2.5,
) -> TTCComputation | None:
    """Return constant-velocity TTC when the pair enters the collision envelope."""
    relative_position = (actor_b.x - actor_a.x, actor_b.y - actor_a.y)
    velocity_a = actor_a.velocity
    velocity_b = actor_b.velocity
    relative_velocity = (
        velocity_b[0] - velocity_a[0],
        velocity_b[1] - velocity_a[1],
    )
    distance_squared = sum(value * value for value in relative_position)
    velocity_squared = sum(value * value for value in relative_velocity)
    if velocity_squared <= 1e-9:
        return None
    position_velocity_dot = sum(
        position * velocity
        for position, velocity in zip(relative_position, relative_velocity, strict=True)
    )
    if position_velocity_dot >= 0:
        return None
    if distance_squared <= collision_distance_m**2:
        return TTCComputation(
            time_to_collision_s=0.0,
            closest_approach_m=math.sqrt(distance_squared),
            relative_position=relative_position,
            relative_velocity=relative_velocity,
            relative_speed_mps=math.sqrt(velocity_squared),
        )
    time_to_closest = -position_velocity_dot / velocity_squared
    closest_vector = tuple(
        position + velocity * time_to_closest
        for position, velocity in zip(relative_position, relative_velocity, strict=True)
    )
    closest_distance = math.hypot(*closest_vector)
    if closest_distance > collision_distance_m:
        return None
    quadratic_b = 2 * position_velocity_dot
    quadratic_c = distance_squared - collision_distance_m**2
    discriminant = quadratic_b**2 - 4 * velocity_squared * quadratic_c
    if discriminant < 0:
        return None
    first_contact = (-quadratic_b - math.sqrt(discriminant)) / (2 * velocity_squared)
    if first_contact < 0:
        return None
    return TTCComputation(
        time_to_collision_s=first_contact,
        closest_approach_m=closest_distance,
        relative_position=relative_position,
        relative_velocity=relative_velocity,
        relative_speed_mps=math.sqrt(velocity_squared),
    )


def detect_ttc_events(
    states: list[ActorState],
    config: SafetyConfig,
    other_states: list[ActorState] | None = None,
) -> list[TTCEvent]:
    events = []
    maximum_ttc = max(config.ttc_thresholds_s)
    pairs = (
        itertools.product(states, other_states)
        if other_states is not None
        else itertools.combinations(states, 2)
    )
    for actor_a, actor_b in pairs:
        separation = math.hypot(actor_b.x - actor_a.x, actor_b.y - actor_a.y)
        if separation > config.max_detection_distance_m:
            continue
        calculation = calculate_ttc(actor_a, actor_b, config.collision_distance_m)
        if calculation is None or calculation.time_to_collision_s >= maximum_ttc:
            continue
        events.append(
            TTCEvent(
                simulation_time_s=actor_a.simulation_time_s,
                time_to_collision_s=calculation.time_to_collision_s,
                actor_a_id=actor_a.actor_id,
                actor_b_id=actor_b.actor_id,
                x=(actor_a.x + actor_b.x) / 2,
                y=(actor_a.y + actor_b.y) / 2,
                relative_speed_mps=calculation.relative_speed_mps,
                closest_approach_m=calculation.closest_approach_m,
                relative_position=calculation.relative_position,
                relative_velocity=calculation.relative_velocity,
                actor_a_type=actor_a.actor_type,
                actor_b_type=actor_b.actor_type,
            )
        )
    return events


def minimum_ttc_events(events: list[TTCEvent]) -> list[TTCEvent]:
    """Keep the minimum TTC observation for each vehicle-pair encounter."""
    by_pair: dict[tuple[str, str], TTCEvent] = {}
    for event in events:
        key = tuple(
            sorted(
                (
                    f"{event.actor_a_type}:{event.actor_a_id}",
                    f"{event.actor_b_type}:{event.actor_b_id}",
                )
            )
        )
        existing = by_pair.get(key)
        if existing is None or event.time_to_collision_s < existing.time_to_collision_s:
            by_pair[key] = event
    return sorted(by_pair.values(), key=lambda event: event.simulation_time_s)
