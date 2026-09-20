"""Stable, JSON-serializable interface for Interlock game and backend callers."""

from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from typing import Any

from simulation.compare import compare_scenarios
from simulation.demand import PedestrianDemandConfig
from simulation.interventions import (
    Intervention,
    Scenario,
    SignalTimingChange,
    SpeedLimitChange,
)
from simulation.monte_carlo import ScenarioRunner, run_monte_carlo
from simulation.safety import SafetyConfig

InterventionInput = Intervention | Mapping[str, Any]


def intervention_from_config(config: InterventionInput) -> Intervention:
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


def simulate_scenario(
    intersection_id: str = "fifth-meyran",
    interventions: Sequence[InterventionInput] = (),
    runs: int = 100,
    seed: int = 42,
    *,
    duration_s: int = 3600,
    database_url: str | None = None,
    ttc_thresholds_s: tuple[float, ...] = (1.5, 3.0),
    pedestrians_per_hour: float = 60.0,
    runner: ScenarioRunner | None = None,
) -> dict[str, Any]:
    """Run a game scenario without exposing SUMO, TraCI, or Tiger implementation details."""
    scenario = Scenario(
        intersection_id=intersection_id,
        interventions=tuple(intervention_from_config(item) for item in interventions),
    )
    kwargs: dict[str, Any] = {}
    if runner is not None:
        kwargs["runner"] = runner
    summary = run_monte_carlo(
        scenario=scenario,
        runs=runs,
        base_seed=seed,
        database_url=database_url if database_url is not None else os.getenv("DATABASE_URL"),
        duration_s=duration_s,
        safety_config=SafetyConfig(ttc_thresholds_s=ttc_thresholds_s),
        pedestrian_config=PedestrianDemandConfig(pedestrians_per_hour),
        **kwargs,
    )
    aggregate = summary["aggregate"]
    return {
        "schema_version": "1.0",
        "scenario": summary["scenario"],
        "number_of_runs": aggregate["run_count"],
        "base_seed": seed,
        "run_seeds": summary["seeds"],
        "persisted_run_ids": summary["run_ids"],
        "metrics": aggregate["metrics"],
        "safety": {
            "vehicle_vehicle": aggregate["ttc_thresholds_s"],
            "vehicle_pedestrian": aggregate[
                "vehicle_pedestrian_ttc_thresholds_s"
            ],
        },
        "assumptions": {
            "pedestrians_per_hour": pedestrians_per_hour,
            "pedestrian_demand_observed": False,
            "ttc_thresholds_s": list(ttc_thresholds_s),
        },
    }


def compare_scenario_configs(
    intersection_id: str,
    baseline_interventions: Sequence[InterventionInput],
    modified_interventions: Sequence[InterventionInput],
    runs: int = 100,
    seed: int = 42,
    *,
    duration_s: int = 3600,
    database_url: str | None = None,
    ttc_thresholds_s: tuple[float, ...] = (1.5, 3.0),
    pedestrians_per_hour: float = 60.0,
    runner: ScenarioRunner | None = None,
) -> dict[str, Any]:
    """Compare two game-level configurations using an identical seed list."""
    baseline = Scenario(
        intersection_id,
        tuple(intervention_from_config(item) for item in baseline_interventions),
    )
    modified = Scenario(
        intersection_id,
        tuple(intervention_from_config(item) for item in modified_interventions),
    )
    return compare_scenarios(
        baseline=baseline,
        intervention=modified,
        runs=runs,
        base_seed=seed,
        database_url=(
            database_url if database_url is not None else os.getenv("DATABASE_URL")
        ),
        duration_s=duration_s,
        safety_config=SafetyConfig(ttc_thresholds_s=ttc_thresholds_s),
        pedestrian_config=PedestrianDemandConfig(pedestrians_per_hour),
        runner=runner,
    )
