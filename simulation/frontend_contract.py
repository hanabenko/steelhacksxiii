"""Versioned, frontend-neutral adapter for truthful Interlock SUMO results.

This module accepts a deliberately small subset of the current frontend scenario
shape. It owns translation and validation only; it does not own game scoring,
budgets, objectives, access indices, HTTP, or Three.js projection.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

from weather import get_profile
from simulation.baseline import get_baseline_state, get_scenario_state

CONTRACT_VERSION = 1
FRONTEND_INTERSECTION_ID = "pitt-forbes-bigelow"
SUPPORTED_ZONES = frozenset({"north", "east", "south", "west"})
UNSUPPORTED_INTERVENTIONS = frozenset({"crosswalk", "bike", "curb", "diet"})
MPS_TO_MPH = 2.2369362920544


class FrontendContractValidationError(ValueError):
    """Validation error that can be returned to a frontend without parsing text."""

    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.details = details

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": str(self), "details": self.details}


def _network_metadata() -> dict[str, Any]:
    path = Path(__file__).with_name("networks") / FRONTEND_INTERSECTION_ID / "network.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _require_mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise FrontendContractValidationError(
            "invalid_payload", f"{field} must be an object", field=field
        )
    return value


def _finite_number(value: Any, field: str, *, minimum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise FrontendContractValidationError(
            "invalid_payload", f"{field} must be a number", field=field
        )
    result = float(value)
    if not math.isfinite(result):
        raise FrontendContractValidationError(
            "invalid_payload", f"{field} must be finite", field=field
        )
    if minimum is not None and result < minimum:
        raise FrontendContractValidationError(
            "invalid_payload", f"{field} must be at least {minimum}", field=field
        )
    return result


def validate_frontend_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Normalize the supported subset of the frontend request shape.

    A missing demand means "use the calibrated default". This distinction keeps
    default baseline cache reuse possible and avoids treating the frontend's old
    illustrative 800 veh/h slider default as observed traffic.
    """
    payload = _require_mapping(payload, "payload")
    schema_version = payload.get("schemaVersion", payload.get("schema_version", 2))
    if schema_version != 2:
        raise FrontendContractValidationError(
            "unsupported_schema_version",
            "Only frontend request schema version 2 is supported by this adapter.",
            received=schema_version,
        )
    intersection_id = payload.get("intersection_id", payload.get("intersection"))
    if intersection_id != FRONTEND_INTERSECTION_ID:
        raise FrontendContractValidationError(
            "unsupported_intersection",
            "This first integration target supports Forbes × Bigelow only.",
            requested=intersection_id,
            supported=[FRONTEND_INTERSECTION_ID],
        )

    settings = _require_mapping(payload.get("settings", {}), "settings")
    conditions = _require_mapping(settings.get("conditions", {}), "settings.conditions")
    weather = conditions.get("weather", "clear")
    if not isinstance(weather, str):
        raise FrontendContractValidationError("invalid_payload", "weather must be a supported string")
    try:
        weather = get_profile(weather).id
    except ValueError as exc:
        raise FrontendContractValidationError("invalid_payload", str(exc)) from exc
    runs = int(_finite_number(settings.get("runs", payload.get("runs", 50)), "settings.runs", minimum=1))
    if runs > 1000:
        raise FrontendContractValidationError(
            "invalid_payload", "settings.runs must be at most 1000", field="settings.runs"
        )
    seed = int(_finite_number(payload.get("seed", 42), "seed", minimum=0))
    duration_s = int(_finite_number(payload.get("duration_s", 3600), "duration_s", minimum=1))
    pedestrians_per_hour = _finite_number(
        settings.get("pedestrians_per_hour", payload.get("pedestrians_per_hour", 60)),
        "pedestrians_per_hour",
        minimum=0,
    )
    av_percentage = _finite_number(settings.get("av", payload.get("av_percentage", 0)), "av_percentage", minimum=0)
    if av_percentage > 100:
        raise FrontendContractValidationError(
            "invalid_payload", "av_percentage must be at most 100", field="av_percentage"
        )
    if av_percentage > 0:
        raise FrontendContractValidationError(
            "unsupported_av_behavior",
            "Autonomous-vehicle behavior is not implemented; AV percentage cannot be simulated truthfully.",
            av_percentage=av_percentage,
        )
    demand = settings.get("demand", payload.get("vehicle_demand_vehicles_per_hour"))
    vehicle_demand = (
        _finite_number(demand, "vehicle_demand_vehicles_per_hour", minimum=0.001)
        if demand is not None
        else None
    )
    green = settings.get("green")
    green_seconds = _finite_number(green, "settings.green", minimum=1) if green is not None else 35.0

    raw_interventions = payload.get("interventions", payload.get("upgrades", []))
    if not isinstance(raw_interventions, Sequence) or isinstance(raw_interventions, (str, bytes)):
        raise FrontendContractValidationError(
            "invalid_payload", "upgrades must be an array", field="upgrades"
        )
    translated: list[dict[str, Any]] = []
    for index, raw_item in enumerate(raw_interventions):
        item = _require_mapping(raw_item, f"upgrades[{index}]")
        item_type = item.get("type", item.get("intervention_type"))
        zone = item.get("zone")
        if zone is not None and zone not in SUPPORTED_ZONES:
            raise FrontendContractValidationError(
                "invalid_payload", "upgrade zone is invalid", index=index, zone=zone
            )
        if item_type in UNSUPPORTED_INTERVENTIONS:
            raise FrontendContractValidationError(
                "unsupported_intervention",
                f"{item_type} has no SUMO intervention model yet and was not applied.",
                index=index,
                intervention_type=item_type,
            )
        if item_type == "signal":
            # The legacy UI only exposes one green control. Equal allocation is a
            # transparent temporary mapping; callers may supply both durations.
            main_green = _finite_number(item.get("main_green_s", green_seconds), "main_green_s", minimum=1)
            side_green = _finite_number(item.get("side_green_s", green_seconds), "side_green_s", minimum=1)
            translated.append(
                {
                    "type": "signal_timing",
                    "main_green_s": main_green,
                    "side_green_s": side_green,
                    "frontend_zone": zone,
                }
            )
            continue
        if item_type == "signal_timing":
            translated.append(
                {
                    "type": "signal_timing",
                    "main_green_s": _finite_number(item["main_green_s"], "main_green_s", minimum=1),
                    "side_green_s": _finite_number(item["side_green_s"], "side_green_s", minimum=1),
                    "frontend_zone": zone,
                }
            )
            continue
        if item_type == "speed_limit":
            translated.append(
                {
                    "type": "speed_limit",
                    "speed_limit_mph": _finite_number(item["speed_limit_mph"], "speed_limit_mph", minimum=1),
                    "frontend_zone": zone,
                }
            )
            continue
        raise FrontendContractValidationError(
            "unsupported_intervention",
            "The supplied intervention type is not supported by SUMO yet.",
            index=index,
            intervention_type=item_type,
        )
    if sum(item["type"] == "signal_timing" for item in translated) > 1:
        raise FrontendContractValidationError(
            "invalid_payload", "Only one signal timing change may be applied per scenario."
        )
    if sum(item["type"] == "speed_limit" for item in translated) > 1:
        raise FrontendContractValidationError(
            "invalid_payload", "Only one speed-limit change may be applied per scenario."
        )
    return {
        "intersection_id": intersection_id,
        "runs": runs,
        "seed": seed,
        "duration_s": duration_s,
        "pedestrians_per_hour": pedestrians_per_hour,
        "vehicle_demand_vehicles_per_hour": vehicle_demand,
        "weather": weather,
        "interventions": translated,
    }


def _metric(distribution: Mapping[str, Any], unit: str, description: str) -> dict[str, Any]:
    return {"unit": unit, "description": description, **dict(distribution)}


def _scaled(distribution: Mapping[str, Any], scale: float) -> dict[str, Any]:
    return {
        key: (value * scale if isinstance(value, (int, float)) else value)
        for key, value in distribution.items()
    }


def physical_metrics(state: Mapping[str, Any]) -> dict[str, Any]:
    """Translate stored aggregate metrics into explicit, display-ready units."""
    aggregate = state["aggregate_metrics"]
    metrics = aggregate["metrics"]
    threshold_summaries = aggregate["safety"]["vehicle_vehicle"]
    pedestrian_threshold_summaries = aggregate["safety"]["vehicle_pedestrian"]
    return {
        "mean_speed_mph": _metric(
            _scaled(metrics["mean_speed_mps"], MPS_TO_MPH), "mph", "Mean active-vehicle speed."
        ),
        "median_speed_mph": _metric(
            _scaled(metrics["median_speed_mps"], MPS_TO_MPH), "mph", "Median active-vehicle speed."
        ),
        "average_delay_s_per_vehicle": _metric(
            metrics["average_delay_s"], "seconds per completed vehicle", "SUMO final vehicle time loss."
        ),
        "throughput_vehicles_per_hour": _metric(
            metrics["throughput_vehicles_per_hour"], "completed vehicles per hour", "Hourly-equivalent completed vehicle movements."
        ),
        "vehicles_completed": _metric(metrics["vehicles_completed"], "vehicles", "Completed vehicle movements."),
        "completed_crossings": _metric(metrics["completed_crossings"], "pedestrians", "Completed pedestrian walks."),
        "mean_pedestrian_wait_s": _metric(
            metrics["mean_pedestrian_wait_s"], "seconds", "Mean simulated stationary pedestrian wait."
        ),
        "p95_pedestrian_wait_s": _metric(
            metrics["p95_pedestrian_wait_s"], "seconds", "95th-percentile simulated pedestrian wait."
        ),
        "vehicle_vehicle_ttc_events_per_1000_completed_vehicles": {
            "unit": "TTC conflict events per 1,000 completed vehicles",
            "description": "Constant-velocity vehicle–vehicle TTC conflict surrogate; not predicted crashes.",
            "thresholds_s": {
                key: _metric(
                    summary["events_per_1000_completed_vehicles"],
                    "TTC conflict events per 1,000 completed vehicles",
                    "Event rate for this configurable TTC threshold.",
                )
                for key, summary in threshold_summaries.items()
            },
        },
        "vehicle_pedestrian_ttc_events_per_1000_completed_vehicles": {
            "unit": "TTC conflict events per 1,000 completed vehicles",
            "description": "Constant-velocity vehicle–pedestrian TTC conflict surrogate; not predicted crashes.",
            "thresholds_s": {
                key: _metric(
                    summary["events_per_1000_completed_vehicles"],
                    "TTC conflict events per 1,000 completed vehicles",
                    "Event rate for this configurable TTC threshold.",
                )
                for key, summary in pedestrian_threshold_summaries.items()
            },
        },
    }


def _mean_at(metrics: Mapping[str, Any], key: str) -> float | None:
    value = metrics[key].get("mean")
    return float(value) if isinstance(value, (int, float)) else None


def _delta(baseline: Mapping[str, Any], modified: Mapping[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key in (
        "mean_speed_mph",
        "average_delay_s_per_vehicle",
        "throughput_vehicles_per_hour",
        "vehicles_completed",
        "completed_crossings",
        "mean_pedestrian_wait_s",
        "p95_pedestrian_wait_s",
    ):
        before, after = _mean_at(baseline, key), _mean_at(modified, key)
        result[key] = None if before is None or after is None else after - before
    for key in (
        "vehicle_vehicle_ttc_events_per_1000_completed_vehicles",
        "vehicle_pedestrian_ttc_events_per_1000_completed_vehicles",
    ):
        result[key] = {
            threshold: (
                None
                if baseline[key]["thresholds_s"][threshold].get("mean") is None
                else modified[key]["thresholds_s"][threshold]["mean"]
                - baseline[key]["thresholds_s"][threshold]["mean"]
            )
            for threshold in baseline[key]["thresholds_s"]
        }
    return result


StateLoader = Callable[..., dict[str, Any]]


def simulate_frontend_scenario(
    payload: dict[str, Any],
    *,
    force_refresh: bool = False,
    baseline_loader: StateLoader = get_baseline_state,
    scenario_loader: StateLoader = get_scenario_state,
) -> dict[str, Any]:
    """Return baseline and matched modified SUMO states for the frontend/game layer.

    Invalid inputs return a structured JSON error. Successful calls reuse the
    existing baseline/scenario cache and retain the engine's deterministic seed
    derivation, Tiger persistence, and representative-run selection.
    """
    try:
        config = validate_frontend_payload(payload)
    except FrontendContractValidationError as error:
        return {"contract_version": CONTRACT_VERSION, "error": error.to_dict()}

    common = {
        "intersection_id": config["intersection_id"],
        "runs": config["runs"],
        "seed": config["seed"],
        "duration_s": config["duration_s"],
        "pedestrians_per_hour": config["pedestrians_per_hour"],
        "vehicle_demand_vehicles_per_hour": config["vehicle_demand_vehicles_per_hour"],
        "force_refresh": force_refresh,
        "weather": config["weather"],
    }
    baseline_state = baseline_loader(**common)
    if config["interventions"]:
        modified_state = scenario_loader(interventions=config["interventions"], **common)
    else:
        modified_state = baseline_state
    baseline_metrics = physical_metrics(baseline_state)
    modified_metrics = physical_metrics(modified_state)
    baseline_seeds = baseline_state["assumptions"].get("run_seeds", [])
    modified_seeds = modified_state["assumptions"].get("run_seeds", [])
    return {
        "contract_version": CONTRACT_VERSION,
        "engine": "sumo-traci",
        "intersection": _network_metadata(),
        "baseline": {
            "metrics": baseline_metrics,
            "representative_replay": baseline_state["representative_run"]["replay"],
            "persisted_run_ids": baseline_state.get("persisted_run_ids", []),
        },
        "modified": {
            "metrics": modified_metrics,
            "representative_replay": modified_state["representative_run"]["replay"],
            "persisted_run_ids": modified_state.get("persisted_run_ids", []),
        },
        "delta": _delta(baseline_metrics, modified_metrics),
        "matched_seeds": baseline_seeds,
        "assumptions": [
            "Vehicle and pedestrian arrivals are matched by deterministic per-run seeds.",
            "TTC metrics are constant-velocity simulation conflict surrogates, not predicted crashes.",
            "Pedestrian demand is an explicit configurable assumption, not an observed count.",
            "Forbes/Bigelow currently reuses the documented Fifth/Meyran traffic observation until a complete local calibration is imported.",
            "The smart-signal translation applies equal principal green durations when the legacy request supplies only settings.green.",
            "Replay coordinates are WGS84 plus SUMO local meters; the simulation performs no Three.js projection.",
        ],
        "translation": {
            "accepted_interventions": config["interventions"],
            "vehicle_demand_vehicles_per_hour": config["vehicle_demand_vehicles_per_hour"],
            "matched_seed_lists_equal": baseline_seeds == modified_seeds,
            "weather": get_profile(config["weather"]).to_dict(),
        },
    }
