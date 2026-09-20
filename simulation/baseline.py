"""Cached scenario-state contract for frontend and game consumers."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from scripts.tiger import connection
from simulation.database import load_run_replay_rows
from simulation.demand import PedestrianDemandConfig
from simulation.interventions import InterventionInput, Scenario, intervention_from_config
from simulation.monte_carlo import ScenarioRunner, run_monte_carlo
from simulation.network import NETWORKS
from simulation.replay import build_replay_payload, read_replay_artifact
from simulation.representative import select_representative_run
from simulation.safety import SafetyConfig

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE_ROOT = REPO_ROOT / "simulation" / "cache" / "scenario_states"
CACHE_VERSION = 2


def _cache_parameters(
    scenario: Scenario,
    runs: int,
    seed: int,
    duration_s: int,
    thresholds: tuple[float, ...],
    pedestrians_per_hour: float,
) -> dict[str, Any]:
    return {
        "cache_version": CACHE_VERSION,
        "scenario": scenario.to_dict(),
        "runs": int(runs),
        "seed": int(seed),
        "duration_s": int(duration_s),
        "ttc_thresholds_s": [float(value) for value in thresholds],
        "pedestrians_per_hour": float(pedestrians_per_hour),
    }


def scenario_cache_path(parameters: dict[str, Any], cache_root: Path) -> Path:
    encoded = json.dumps(parameters, sort_keys=True, separators=(",", ":")).encode()
    digest = hashlib.sha256(encoded).hexdigest()[:16]
    intersection_id = parameters["scenario"]["intersection_id"]
    scenario_name = parameters["scenario"]["scenario_name"]
    return cache_root / f"{intersection_id}-{scenario_name}-{digest}.json"


def assemble_scenario_state(
    scenario: Scenario,
    summary: dict[str, Any],
    replay: dict[str, Any],
    assumptions: dict[str, Any],
) -> dict[str, Any]:
    """Build the stable result shape independently of SUMO and persistence."""
    representative = select_representative_run(summary["runs"])
    spec = NETWORKS[scenario.intersection_id]
    aggregate = summary["aggregate"]
    return {
        "schema_version": "1.0",
        "intersection": {
            "id": spec.intersection_id,
            "name": " & ".join(spec.street_names),
            "street_names": list(spec.street_names),
            "center": {
                "longitude": spec.longitude,
                "latitude": spec.latitude,
            },
            "scenario": scenario.to_dict(),
        },
        "aggregate_metrics": {
            "run_count": aggregate["run_count"],
            "metrics": aggregate["metrics"],
            "safety": {
                "vehicle_vehicle": aggregate["ttc_thresholds_s"],
                "vehicle_pedestrian": aggregate[
                    "vehicle_pedestrian_ttc_thresholds_s"
                ],
            },
        },
        "representative_run": {
            **representative["run"],
            "selection": representative["selection"],
            "replay": replay,
        },
        "assumptions": assumptions,
        "persisted_run_ids": summary["run_ids"],
    }


def generate_scenario_state(
    scenario: Scenario,
    runs: int,
    seed: int,
    duration_s: int,
    database_url: str | None,
    thresholds: tuple[float, ...],
    pedestrians_per_hour: float,
    runner: ScenarioRunner | None = None,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {}
    if runner is not None:
        kwargs["runner"] = runner
    summary = run_monte_carlo(
        scenario=scenario,
        runs=runs,
        base_seed=seed,
        database_url=database_url,
        duration_s=duration_s,
        safety_config=SafetyConfig(ttc_thresholds_s=thresholds),
        pedestrian_config=PedestrianDemandConfig(pedestrians_per_hour),
        capture_replays=True,
        **kwargs,
    )
    representative = select_representative_run(summary["runs"])
    run_id = representative["run"]["run_id"]
    artifact_paths = {
        key: Path(value) for key, value in summary["replay_artifacts"].items()
    }
    try:
        artifact = artifact_paths.get(run_id)
        if artifact is None:
            raise RuntimeError(f"Representative run {run_id} has no pedestrian replay artifact")
        with connection(database_url) as conn:
            actual_duration, frame_times, vehicle_rows = load_run_replay_rows(conn, run_id)
        artifact_payload = read_replay_artifact(artifact)
        replay = build_replay_payload(
            duration_s=actual_duration,
            frame_times=frame_times,
            vehicle_rows=vehicle_rows,
            pedestrian_rows=artifact_payload["states"],
            signal_states=artifact_payload["signal_states"],
            safety_events=artifact_payload["safety_events"],
        )
        return assemble_scenario_state(
            scenario,
            summary,
            replay,
            assumptions={
                "base_seed": seed,
                "run_seeds": summary["seeds"],
                "duration_s": duration_s,
                "ttc_thresholds_s": list(thresholds),
                "pedestrians_per_hour": pedestrians_per_hour,
                "pedestrian_demand_observed": False,
                "vehicle_replay_source": "Tiger Data vehicle_states",
                "vehicle_heading_source": "derived from consecutive persisted coordinates",
                "pedestrian_replay_source": "simulation-owned run artifact",
            },
        )
    finally:
        for artifact in artifact_paths.values():
            artifact.unlink(missing_ok=True)


def get_scenario_state(
    intersection_id: str = "fifth-meyran",
    interventions: tuple[InterventionInput, ...] | list[InterventionInput] = (),
    runs: int = 50,
    seed: int = 42,
    *,
    duration_s: int = 3600,
    database_url: str | None = None,
    ttc_thresholds_s: tuple[float, ...] = (1.5, 3.0),
    pedestrians_per_hour: float = 60.0,
    vehicle_demand_vehicles_per_hour: float | None = None,
    weather: str = "clear",
    force_refresh: bool = False,
    cache_root: Path | None = None,
    runner: ScenarioRunner | None = None,
) -> dict[str, Any]:
    """Return a cached or freshly generated scenario state and real replay."""
    scenario = Scenario(
        intersection_id,
        tuple(intervention_from_config(item) for item in interventions),
        vehicle_demand_vehicles_per_hour=vehicle_demand_vehicles_per_hour,
        weather=weather,
    )
    parameters = _cache_parameters(
        scenario,
        runs,
        seed,
        duration_s,
        ttc_thresholds_s,
        pedestrians_per_hour,
    )
    cache_path = scenario_cache_path(parameters, cache_root or DEFAULT_CACHE_ROOT)
    if cache_path.exists() and not force_refresh:
        try:
            return json.loads(cache_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    state = generate_scenario_state(
        scenario=scenario,
        runs=runs,
        seed=seed,
        duration_s=duration_s,
        database_url=database_url if database_url is not None else os.getenv("DATABASE_URL"),
        thresholds=ttc_thresholds_s,
        pedestrians_per_hour=pedestrians_per_hour,
        runner=runner,
    )
    state["assumptions"]["generated_at"] = datetime.now(UTC).isoformat()
    state["assumptions"]["cache_parameters"] = parameters
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = cache_path.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    temporary.replace(cache_path)
    return state


def get_baseline_state(
    intersection_id: str = "fifth-meyran",
    runs: int = 50,
    seed: int = 42,
    **kwargs: Any,
) -> dict[str, Any]:
    """Return the cached default intersection state with no interventions."""
    return get_scenario_state(
        intersection_id=intersection_id,
        interventions=(),
        runs=runs,
        seed=seed,
        **kwargs,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Precompute an Interlock baseline-state cache")
    parser.add_argument("--intersection", default="fifth-meyran")
    parser.add_argument("--runs", type=int, default=50)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--duration", type=int, default=3600)
    parser.add_argument("--pedestrians-per-hour", type=float, default=60.0)
    parser.add_argument("--force-refresh", action="store_true")
    args = parser.parse_args()
    state = get_baseline_state(
        intersection_id=args.intersection,
        runs=args.runs,
        seed=args.seed,
        duration_s=args.duration,
        pedestrians_per_hour=args.pedestrians_per_hour,
        force_refresh=args.force_refresh,
    )
    print(
        json.dumps(
            {
                "intersection_id": state["intersection"]["id"],
                "run_count": state["aggregate_metrics"]["run_count"],
                "representative_run_id": state["representative_run"]["run_id"],
                "replay_frames": len(state["representative_run"]["replay"]["frames"]),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
