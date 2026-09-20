"""Matched-seed comparison for a baseline and one modified scenario."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from simulation.demand import PedestrianDemandConfig
from simulation.interventions import Scenario, SignalTimingChange, SpeedLimitChange
from simulation.metrics import threshold_key
from simulation.monte_carlo import ScenarioRunner, derive_run_seeds, run_monte_carlo
from simulation.safety import SafetyConfig


def compare_scenarios(
    baseline: Scenario,
    intervention: Scenario,
    runs: int,
    base_seed: int,
    database_url: str | None,
    duration_s: int = 3600,
    safety_config: SafetyConfig | None = None,
    runner: ScenarioRunner | None = None,
    pedestrian_config: PedestrianDemandConfig | None = None,
) -> dict[str, Any]:
    if baseline.intersection_id != intervention.intersection_id:
        raise ValueError("Matched scenarios must use the same intersection")
    safety_config = safety_config or SafetyConfig()
    seeds = derive_run_seeds(base_seed, runs)
    extra = {"runner": runner} if runner is not None else {}
    baseline_summary = run_monte_carlo(
        baseline,
        runs,
        base_seed,
        database_url,
        duration_s,
        safety_config,
        seeds,
        pedestrian_config=pedestrian_config,
        **extra,
    )
    intervention_summary = run_monte_carlo(
        intervention,
        runs,
        base_seed,
        database_url,
        duration_s,
        safety_config,
        seeds,
        pedestrian_config=pedestrian_config,
        **extra,
    )

    def mean(summary: dict[str, Any], metric: str) -> float | None:
        return summary["aggregate"]["metrics"][metric]["mean"]

    def difference(metric: str) -> float | None:
        before = mean(baseline_summary, metric)
        after = mean(intervention_summary, metric)
        return None if before is None or after is None else after - before

    low_threshold = min(safety_config.ttc_thresholds_s)
    low_key = threshold_key(low_threshold)
    baseline_low = baseline_summary["aggregate"]["ttc_thresholds_s"][low_key][
        "event_count"
    ]["mean"]
    intervention_low = intervention_summary["aggregate"]["ttc_thresholds_s"][low_key][
        "event_count"
    ]["mean"]
    baseline_pedestrian_low = baseline_summary["aggregate"][
        "vehicle_pedestrian_ttc_thresholds_s"
    ][low_key]["event_count"]["mean"]
    intervention_pedestrian_low = intervention_summary["aggregate"][
        "vehicle_pedestrian_ttc_thresholds_s"
    ][low_key]["event_count"]["mean"]
    return {
        "schema_version": "1.0",
        "matched_seeds": seeds,
        "baseline": baseline_summary,
        "intervention": intervention_summary,
        "delta": {
            "mean_speed_mps": difference("mean_speed_mps"),
            "throughput_vehicles_per_hour": difference("throughput_vehicles_per_hour"),
            "average_delay_s": difference("average_delay_s"),
            "low_ttc_threshold_s": low_threshold,
            "low_ttc_events": intervention_low - baseline_low,
            "completed_crossings": difference("completed_crossings"),
            "mean_pedestrian_wait_s": difference("mean_pedestrian_wait_s"),
            "p95_pedestrian_wait_s": difference("p95_pedestrian_wait_s"),
            "vehicle_pedestrian_low_ttc_events": (
                intervention_pedestrian_low - baseline_pedestrian_low
            ),
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--intersection", default="fifth-meyran")
    parser.add_argument("--runs", type=int, default=100)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--duration", type=int, default=3600)
    parser.add_argument("--speed-limit", type=float, default=20.0)
    parser.add_argument("--main-green", type=float)
    parser.add_argument("--side-green", type=float)
    parser.add_argument("--pedestrians-per-hour", type=float, default=60.0)
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--ttc-thresholds", default="1.5,3.0")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        thresholds = tuple(float(value.strip()) for value in args.ttc_thresholds.split(","))
        if (args.main_green is None) != (args.side_green is None):
            raise ValueError("--main-green and --side-green must be supplied together")
        intervention = (
            SignalTimingChange(args.main_green, args.side_green)
            if args.main_green is not None
            else SpeedLimitChange(args.speed_limit)
        )
        result = compare_scenarios(
            baseline=Scenario(args.intersection, []),
            intervention=Scenario(
                args.intersection,
                [intervention],
            ),
            runs=args.runs,
            base_seed=args.seed,
            database_url=args.database_url,
            duration_s=args.duration,
            safety_config=SafetyConfig(ttc_thresholds_s=thresholds),
            pedestrian_config=PedestrianDemandConfig(args.pedestrians_per_hour),
        )
    except (RuntimeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
