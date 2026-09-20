"""Pure metric calculations for individual and repeated simulation runs."""

from __future__ import annotations

import math
import statistics
from typing import Any

from simulation.models import RunMetrics, TTCEvent


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    if not 0 <= fraction <= 1:
        raise ValueError("Percentile fraction must be between zero and one")
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def threshold_key(threshold_s: float) -> str:
    return f"{threshold_s:g}"


def calculate_run_metrics(
    speeds_mps: list[float],
    vehicles_completed: int,
    duration_s: float,
    vehicle_delays_s: list[float],
    ttc_events: list[TTCEvent],
    thresholds_s: tuple[float, ...],
    pedestrians_completed: int = 0,
    pedestrian_waits_s: list[float] | None = None,
    vehicle_pedestrian_events: list[TTCEvent] | None = None,
) -> RunMetrics:
    if duration_s <= 0:
        raise ValueError("Run duration must be positive")
    pedestrian_waits_s = pedestrian_waits_s or []
    vehicle_pedestrian_events = vehicle_pedestrian_events or []
    return RunMetrics(
        mean_speed_mps=statistics.fmean(speeds_mps) if speeds_mps else None,
        median_speed_mps=statistics.median(speeds_mps) if speeds_mps else None,
        vehicles_completed=vehicles_completed,
        throughput_vehicles_per_hour=vehicles_completed * 3600 / duration_s,
        average_delay_s=statistics.fmean(vehicle_delays_s) if vehicle_delays_s else None,
        minimum_ttc_s=(
            min(event.time_to_collision_s for event in ttc_events) if ttc_events else None
        ),
        ttc_event_counts={
            threshold_key(threshold): sum(
                event.time_to_collision_s < threshold for event in ttc_events
            )
            for threshold in thresholds_s
        },
        completed_crossings=pedestrians_completed,
        mean_pedestrian_wait_s=(
            statistics.fmean(pedestrian_waits_s) if pedestrian_waits_s else None
        ),
        p95_pedestrian_wait_s=percentile(pedestrian_waits_s, 0.95),
        vehicle_pedestrian_minimum_ttc_s=(
            min(event.time_to_collision_s for event in vehicle_pedestrian_events)
            if vehicle_pedestrian_events
            else None
        ),
        vehicle_pedestrian_ttc_event_counts={
            threshold_key(threshold): sum(
                event.time_to_collision_s < threshold
                for event in vehicle_pedestrian_events
            )
            for threshold in thresholds_s
        },
    )


def distribution(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {key: None for key in ("mean", "median", "stddev", "p5", "p25", "p75", "p95")}
    return {
        "mean": statistics.fmean(values),
        "median": statistics.median(values),
        "stddev": statistics.pstdev(values),
        "p5": percentile(values, 0.05),
        "p25": percentile(values, 0.25),
        "p75": percentile(values, 0.75),
        "p95": percentile(values, 0.95),
    }


def aggregate_run_metrics(
    runs: list[RunMetrics], thresholds_s: tuple[float, ...]
) -> dict[str, Any]:
    numeric_fields = (
        "mean_speed_mps",
        "median_speed_mps",
        "vehicles_completed",
        "throughput_vehicles_per_hour",
        "average_delay_s",
        "minimum_ttc_s",
        "completed_crossings",
        "mean_pedestrian_wait_s",
        "p95_pedestrian_wait_s",
        "vehicle_pedestrian_minimum_ttc_s",
    )
    metrics = {}
    for field in numeric_fields:
        values = [float(value) for run in runs if (value := getattr(run, field)) is not None]
        metrics[field] = distribution(values)
    threshold_summary = {}
    pedestrian_threshold_summary = {}
    for threshold in thresholds_s:
        key = threshold_key(threshold)
        counts = [float(run.ttc_event_counts[key]) for run in runs]
        pedestrian_counts = [
            float((run.vehicle_pedestrian_ttc_event_counts or {}).get(key, 0))
            for run in runs
        ]
        threshold_summary[key] = {
            "event_count": distribution(counts),
            "proportion_of_runs_with_event": (
                sum(count > 0 for count in counts) / len(counts) if counts else 0.0
            ),
        }
        pedestrian_threshold_summary[key] = {
            "event_count": distribution(pedestrian_counts),
            "proportion_of_runs_with_event": (
                sum(count > 0 for count in pedestrian_counts) / len(pedestrian_counts)
                if pedestrian_counts
                else 0.0
            ),
        }
    return {
        "run_count": len(runs),
        "metrics": metrics,
        "ttc_thresholds_s": threshold_summary,
        "vehicle_pedestrian_ttc_thresholds_s": pedestrian_threshold_summary,
    }
