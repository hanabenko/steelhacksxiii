"""Deterministic selection of an actual run nearest to Monte Carlo medians."""

from __future__ import annotations

import math
import statistics
from typing import Any

CORE_FIELDS = (
    "mean_speed_mps",
    "median_speed_mps",
    "vehicles_completed",
    "throughput_vehicles_per_hour",
    "average_delay_s",
    "completed_crossings",
    "mean_pedestrian_wait_s",
    "p95_pedestrian_wait_s",
)


def _metric_vector(run: dict[str, Any]) -> dict[str, float | None]:
    metrics = run["metrics"]
    vector = {
        field: (float(value) if (value := metrics.get(field)) is not None else None)
        for field in CORE_FIELDS
    }
    for category in ("ttc_event_counts", "vehicle_pedestrian_ttc_event_counts"):
        for threshold, count in sorted((metrics.get(category) or {}).items()):
            vector[f"{category}.{threshold}"] = float(count)
    return vector


def select_representative_run(runs: list[dict[str, Any]]) -> dict[str, Any]:
    """Choose the real run with minimum normalized distance to metric medians."""
    if not runs:
        raise ValueError("At least one run is required for representative selection")
    vectors = [_metric_vector(run) for run in runs]
    fields = sorted({field for vector in vectors for field in vector})
    medians: dict[str, float | None] = {}
    scales: dict[str, float] = {}
    for field in fields:
        values = [float(vector[field]) for vector in vectors if vector.get(field) is not None]
        medians[field] = statistics.median(values) if values else None
        scale = max(values) - min(values) if values else 0.0
        scales[field] = scale if scale > 0 else 1.0

    candidates = []
    for run, vector in zip(runs, vectors, strict=True):
        squared_distance = 0.0
        for field in fields:
            median = medians[field]
            if median is None:
                continue
            value = vector.get(field)
            difference = 1.0 if value is None else (value - median) / scales[field]
            squared_distance += difference**2
        candidates.append(
            (
                math.sqrt(squared_distance),
                int(run["seed"]),
                str(run["run_id"]),
                run,
            )
        )
    distance, _, _, selected = min(candidates, key=lambda item: item[:3])
    return {
        "run": selected,
        "selection": {
            "method": "normalized_euclidean_distance_to_metric_medians",
            "distance": distance,
            "median_metric_vector": medians,
            "normalization": "observed_range_per_metric; zero-range metrics use scale 1",
            "tie_break": "lowest seed, then lexicographically lowest run_id",
        },
    }
