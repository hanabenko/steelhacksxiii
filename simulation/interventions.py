"""Scenario and infrastructure-intervention abstractions."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from simulation.models import Calibration
from weather import DEFAULT_WEATHER, get_profile


@dataclass(frozen=True)
class SpeedLimitChange:
    speed_limit_mph: float
    intervention_type: str = field(default="speed_limit", init=False)

    def __post_init__(self) -> None:
        if self.speed_limit_mph <= 0:
            raise ValueError("Speed limit must be positive")

    def to_dict(self) -> dict[str, float | str]:
        return {
            "intervention_type": self.intervention_type,
            "speed_limit_mph": self.speed_limit_mph,
        }


@dataclass(frozen=True)
class SignalTimingChange:
    """Game-facing allocation for the two principal vehicle green phases."""

    main_green_s: float
    side_green_s: float
    intervention_type: str = field(default="signal_timing", init=False)

    def __post_init__(self) -> None:
        if self.main_green_s <= 0 or self.side_green_s <= 0:
            raise ValueError("Signal green durations must be positive")

    def to_dict(self) -> dict[str, float | str]:
        return {
            "intervention_type": self.intervention_type,
            "main_green_s": self.main_green_s,
            "side_green_s": self.side_green_s,
        }


Intervention = SpeedLimitChange | SignalTimingChange
InterventionInput = Intervention | Mapping[str, Any]


def intervention_from_config(config: InterventionInput) -> Intervention:
    """Normalize a game-friendly dictionary or an intervention object."""
    if isinstance(config, (SpeedLimitChange, SignalTimingChange)):
        return config
    intervention_type = config.get("type", config.get("intervention_type"))
    if intervention_type == "speed_limit":
        return SpeedLimitChange(float(config["speed_limit_mph"]))
    if intervention_type == "signal_timing":
        return SignalTimingChange(
            main_green_s=float(config["main_green_s"]),
            side_green_s=float(config["side_green_s"]),
        )
    raise ValueError(f"Unsupported intervention type: {intervention_type!r}")


@dataclass(frozen=True)
class Scenario:
    intersection_id: str
    interventions: tuple[Intervention, ...] | list[Intervention] = ()
    scenario_name: str | None = None
    vehicle_demand_vehicles_per_hour: float | None = None
    weather: str = DEFAULT_WEATHER

    def __post_init__(self) -> None:
        object.__setattr__(self, "interventions", tuple(self.interventions))
        # Raises on an unknown condition rather than silently simulating clear.
        get_profile(self.weather)
        if (
            self.vehicle_demand_vehicles_per_hour is not None
            and self.vehicle_demand_vehicles_per_hour <= 0
        ):
            raise ValueError("Vehicle demand must be positive when supplied")
        speed_changes = [
            item for item in self.interventions if isinstance(item, SpeedLimitChange)
        ]
        if len(speed_changes) > 1:
            raise ValueError("A scenario may contain only one speed-limit change")
        signal_changes = [
            item for item in self.interventions if isinstance(item, SignalTimingChange)
        ]
        if len(signal_changes) > 1:
            raise ValueError("A scenario may contain only one signal-timing change")

    @property
    def name(self) -> str:
        if self.scenario_name:
            return self.scenario_name
        suffix = "" if self.weather == DEFAULT_WEATHER else f"-{self.weather}"
        if not self.interventions:
            return f"baseline-osm{suffix}"
        parts = []
        for intervention in self.interventions:
            if isinstance(intervention, SpeedLimitChange):
                parts.append(f"speed-limit-{intervention.speed_limit_mph:g}-mph")
            elif isinstance(intervention, SignalTimingChange):
                parts.append(
                    f"signal-{intervention.main_green_s:g}-{intervention.side_green_s:g}"
                )
        return "+".join(parts) + suffix

    def effective_speed_limit_mph(self, calibration: Calibration | None) -> float:
        for intervention in self.interventions:
            if isinstance(intervention, SpeedLimitChange):
                return intervention.speed_limit_mph
        if calibration is None:
            raise ValueError("Baseline speed limit requires calibration")
        return calibration.speed_limit_mph

    def to_dict(self) -> dict[str, Any]:
        return {
            "intersection_id": self.intersection_id,
            "scenario_name": self.name,
            "interventions": [item.to_dict() for item in self.interventions],
            "vehicle_demand_vehicles_per_hour": self.vehicle_demand_vehicles_per_hour,
            "weather": get_profile(self.weather).to_dict(),
        }
