"""Run deterministic batches of stochastic SUMO simulations."""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from simulation.demand import PedestrianDemandConfig
from simulation.engine import run_scenario
from simulation.interventions import Scenario, SpeedLimitChange
from simulation.metrics import aggregate_run_metrics
from simulation.models import SimulationResult
from simulation.safety import SafetyConfig

ProgressCallback = Callable[[int, int, int, SimulationResult], None]
ScenarioRunner = Callable[..., SimulationResult]


def derive_run_seeds(base_seed: int, runs: int) -> list[int]:
    if runs < 1:
        raise ValueError("Monte Carlo runs must be at least one")
    randomizer = random.Random(base_seed)
    seeds = []
    seen = set()
    while len(seeds) < runs:
        candidate = randomizer.randrange(1, 2**31)
        if candidate not in seen:
            seen.add(candidate)
            seeds.append(candidate)
    return seeds


def run_monte_carlo(
    scenario: Scenario,
    runs: int,
    base_seed: int,
    database_url: str | None,
    duration_s: int = 3600,
    safety_config: SafetyConfig | None = None,
    seeds: Sequence[int] | None = None,
    progress: ProgressCallback | None = None,
    runner: ScenarioRunner = run_scenario,
    pedestrian_config: PedestrianDemandConfig | None = None,
) -> dict[str, Any]:
    safety_config = safety_config or SafetyConfig()
    run_seeds = list(seeds) if seeds is not None else derive_run_seeds(base_seed, runs)
    if len(run_seeds) != runs:
        raise ValueError("The number of supplied seeds must equal runs")
    results = []
    for index, seed in enumerate(run_seeds, start=1):
        result = runner(
            scenario=scenario,
            seed=seed,
            database_url=database_url,
            duration_s=duration_s,
            safety_config=safety_config,
            pedestrian_config=pedestrian_config,
        )
        results.append(result)
        if progress:
            progress(index, runs, seed, result)
    return {
        "scenario": scenario.to_dict(),
        "base_seed": base_seed,
        "seeds": run_seeds,
        "run_ids": [str(result.run_id) for result in results],
        "aggregate": aggregate_run_metrics(
            [result.metrics for result in results], safety_config.ttc_thresholds_s
        ),
    }


def parse_thresholds(value: str) -> tuple[float, ...]:
    try:
        return tuple(float(item.strip()) for item in value.split(",") if item.strip())
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Thresholds must be comma-separated seconds") from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--intersection", default="fifth-meyran")
    parser.add_argument("--runs", type=int, default=100)
    parser.add_argument("--seed", type=int, default=42, help="Base seed")
    parser.add_argument("--duration", type=int, default=3600)
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--ttc-thresholds", type=parse_thresholds, default=(1.5, 3.0))
    parser.add_argument("--speed-limit", type=float)
    parser.add_argument("--pedestrians-per-hour", type=float, default=60.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    interventions = []
    if args.speed_limit is not None:
        interventions.append(SpeedLimitChange(args.speed_limit))
    scenario = Scenario(args.intersection, interventions)

    def report(index: int, total: int, seed: int, result: SimulationResult) -> None:
        print(
            f"[{index}/{total}] seed={seed} run_id={result.run_id}",
            file=sys.stderr,
        )

    try:
        summary = run_monte_carlo(
            scenario=scenario,
            runs=args.runs,
            base_seed=args.seed,
            database_url=args.database_url,
            duration_s=args.duration,
            safety_config=SafetyConfig(ttc_thresholds_s=args.ttc_thresholds),
            progress=report,
            pedestrian_config=PedestrianDemandConfig(args.pedestrians_per_hour),
        )
    except (RuntimeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
