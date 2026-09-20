"""CLI for one calibrated Interlock SUMO scenario."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from simulation.demand import PedestrianDemandConfig
from simulation.engine import run_scenario
from simulation.interventions import Scenario, SignalTimingChange, SpeedLimitChange
from simulation.safety import SafetyConfig


def parse_thresholds(value: str) -> tuple[float, ...]:
    try:
        return tuple(float(item.strip()) for item in value.split(",") if item.strip())
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Thresholds must be comma-separated seconds") from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--intersection", default="fifth-meyran")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--duration", type=int, default=3600, help="Simulation seconds")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--ttc-thresholds", type=parse_thresholds, default=(1.5, 3.0))
    parser.add_argument("--speed-limit", type=float, help="Modified scenario speed limit in mph")
    parser.add_argument("--main-green", type=float)
    parser.add_argument("--side-green", type=float)
    parser.add_argument("--pedestrians-per-hour", type=float, default=60.0)
    parser.add_argument("--gui", action="store_true", help="Run sumo-gui instead of sumo")
    parser.add_argument("--rebuild-network", action="store_true")
    parser.add_argument("--keep-output", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    interventions = []
    if args.speed_limit is not None:
        interventions.append(SpeedLimitChange(args.speed_limit))
    if (args.main_green is None) != (args.side_green is None):
        print("error: --main-green and --side-green must be supplied together", file=sys.stderr)
        return 1
    if args.main_green is not None:
        interventions.append(SignalTimingChange(args.main_green, args.side_green))
    scenario = Scenario(args.intersection, interventions)
    try:
        result = run_scenario(
            scenario=scenario,
            seed=args.seed,
            database_url=args.database_url,
            duration_s=args.duration,
            safety_config=SafetyConfig(ttc_thresholds_s=args.ttc_thresholds),
            gui=args.gui,
            rebuild_network=args.rebuild_network,
            keep_output=args.keep_output,
            pedestrian_config=PedestrianDemandConfig(args.pedestrians_per_hour),
        )
    except (RuntimeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result.to_dict(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
