"""Rank signalized Pittsburgh intersections by data coverage and safety priority."""

from __future__ import annotations

import argparse
from pathlib import Path

import geopandas as gpd
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = REPO_ROOT / "data"
METRIC_CRS = "EPSG:26917"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--since-year", type=int, default=2019)
    return parser.parse_args()


def counts_in_buffer(
    candidates: gpd.GeoDataFrame,
    observations: gpd.GeoDataFrame,
    distance_m: float,
    prefix: str,
) -> pd.DataFrame:
    buffers = candidates[["candidate_id", "geometry"]].copy()
    buffers["geometry"] = buffers.geometry.buffer(distance_m)
    joined = gpd.sjoin(observations, buffers, predicate="intersects", how="inner")
    if joined.empty:
        return pd.DataFrame(index=candidates["candidate_id"])
    return joined.groupby("candidate_id").size().rename(f"{prefix}_count").to_frame()


def crash_metrics(
    candidates: gpd.GeoDataFrame, crashes: gpd.GeoDataFrame, distance_m: float
) -> pd.DataFrame:
    buffers = candidates[["candidate_id", "geometry"]].copy()
    buffers["geometry"] = buffers.geometry.buffer(distance_m)
    joined = gpd.sjoin(crashes, buffers, predicate="within", how="inner")
    if joined.empty:
        return pd.DataFrame(index=candidates["candidate_id"])
    joined["severe_event"] = (joined["fatalities"] > 0) | (joined["serious_injuries"] > 0)
    joined["injury_event"] = joined["injuries"] > 0
    joined["vru_event"] = joined["vulnerable_road_user_count"] > 0
    return joined.groupby("candidate_id").agg(
        crash_count=("crash_id", "nunique"),
        injury_crash_count=("injury_event", "sum"),
        severe_crash_count=("severe_event", "sum"),
        vru_crash_count=("vru_event", "sum"),
        fatalities=("fatalities", "sum"),
        injuries=("injuries", "sum"),
    )


def percentile(series: pd.Series) -> pd.Series:
    if series.max() == series.min():
        return pd.Series(0.0, index=series.index)
    return series.rank(method="average", pct=True)


def main() -> None:
    args = parse_args()
    normalized = args.data_root / "normalized"
    derived = args.data_root / "derived"
    derived.mkdir(parents=True, exist_ok=True)

    signals = gpd.read_parquet(normalized / "signals.parquet")
    signals = signals.loc[
        signals.geometry.notna()
        & ~signals.geometry.is_empty
        & signals.geometry.x.between(-80.2, -79.7)
        & signals.geometry.y.between(40.3, 40.6)
    ].to_crs(METRIC_CRS)
    signals = signals.reset_index(drop=True)
    signals["candidate_id"] = "signal_" + signals["id"].astype("string")
    traffic = gpd.read_parquet(normalized / "traffic_counts.parquet").to_crs(METRIC_CRS)
    traffic["has_volume_or_speed"] = (
        traffic[["average_daily_car_traffic", "median_speed", "speed85_percent"]]
        .notna()
        .any(axis=1)
    )
    usable_traffic = traffic.loc[traffic["has_volume_or_speed"]]
    crosswalks = gpd.read_parquet(normalized / "crosswalks.parquet").to_crs(METRIC_CRS)
    crosswalks = crosswalks.loc[crosswalks["inactive"].fillna(0).astype(int) == 0]
    hin = gpd.read_parquet(normalized / "high_injury_segments.parquet").to_crs(METRIC_CRS)
    crashes = gpd.read_parquet(normalized / "pittsburgh_crash_events.parquet")
    crashes = crashes.loc[~crashes.geometry.is_empty]
    crashes = crashes.loc[(crashes["year"] >= args.since_year) & crashes.geometry.notna()].to_crs(
        METRIC_CRS
    )

    metrics = signals.set_index("candidate_id")
    metrics = metrics.join(counts_in_buffer(signals, usable_traffic, 200, "traffic"))
    metrics = metrics.join(counts_in_buffer(signals, crosswalks, 75, "crosswalk"))
    metrics = metrics.join(counts_in_buffer(signals, hin, 50, "hin"))
    metrics = metrics.join(crash_metrics(signals, crashes, 150))
    count_columns = [
        "traffic_count",
        "crosswalk_count",
        "hin_count",
        "crash_count",
        "injury_crash_count",
        "severe_crash_count",
        "vru_crash_count",
        "fatalities",
        "injuries",
    ]
    metrics[count_columns] = metrics[count_columns].fillna(0).astype(int)

    operation_known = metrics["operation_type"].notna() & metrics["operation_type"].ne("")
    metrics["coverage_points"] = (
        (metrics["traffic_count"] > 0).astype(int) * 35
        + (metrics["crash_count"] >= 3).astype(int) * 25
        + (metrics["crosswalk_count"] > 0).astype(int) * 15
        + operation_known.astype(int) * 15
    )
    metrics["coverage_score_pre_osm"] = (metrics["coverage_points"] / 90 * 100).round(1)
    metrics["osm_status"] = "not_assessed"
    metrics["safety_priority_score"] = (
        (
            percentile(metrics["crash_count"]) * 0.25
            + percentile(metrics["injury_crash_count"]) * 0.25
            + percentile(metrics["severe_crash_count"]) * 0.25
            + percentile(metrics["vru_crash_count"]) * 0.15
            + (metrics["hin_count"] > 0).astype(float) * 0.10
        )
        .mul(100)
        .round(1)
    )
    metrics["selection_score"] = (
        metrics["coverage_score_pre_osm"] * 0.65 + metrics["safety_priority_score"] * 0.35
    ).round(1)
    metrics["crash_window"] = f"{args.since_year}-2025"
    metrics = metrics.sort_values(
        ["selection_score", "coverage_score_pre_osm", "safety_priority_score"], ascending=False
    )

    output = gpd.GeoDataFrame(metrics.reset_index(), geometry="geometry", crs=METRIC_CRS)
    output.to_parquet(derived / "intersection_candidates.parquet", index=False)
    output.to_crs("EPSG:4326").to_file(
        derived / "intersection_candidates.geojson", driver="GeoJSON"
    )
    columns = [
        "candidate_id",
        "description",
        "operation_type",
        "traffic_count",
        "crash_count",
        "injury_crash_count",
        "severe_crash_count",
        "vru_crash_count",
        "crosswalk_count",
        "hin_count",
        "coverage_score_pre_osm",
        "safety_priority_score",
        "selection_score",
        "osm_status",
    ]
    output.drop(columns="geometry")[columns].head(25).to_csv(
        derived / "top_intersection_candidates.csv", index=False
    )
    print(output.drop(columns="geometry")[columns].head(15).to_string(index=False))


if __name__ == "__main__":
    main()
