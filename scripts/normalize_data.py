"""Normalize raw Interlock inputs into typed GeoParquet datasets."""

from __future__ import annotations

import argparse
import csv
import re
import shutil
from pathlib import Path

import geopandas as gpd
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = REPO_ROOT / "data"
PITTSBURGH_MUNICIPALITY_CODE = 2301


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    return parser.parse_args()


def snake_case(value: str) -> str:
    value = re.sub(r"(?<!^)(?=[A-Z])", "_", value)
    return re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_").lower()


def numeric(frame: pd.DataFrame, name: str, default: float | None = None) -> pd.Series:
    if name not in frame:
        return pd.Series(default, index=frame.index, dtype="Float64")
    return pd.to_numeric(frame[name], errors="coerce").astype("Float64")


def text(frame: pd.DataFrame, name: str) -> pd.Series:
    if name not in frame:
        return pd.Series(pd.NA, index=frame.index, dtype="string")
    return frame[name].astype("string").str.strip().replace("", pd.NA)


def truthy(frame: pd.DataFrame, name: str) -> pd.Series:
    values = text(frame, name).str.upper()
    return values.isin(["1", "Y", "YES", "TRUE", "T"])


def read_municipalities(path: Path) -> dict[int, str]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return {int(row["Code"]): row["Municipality"] for row in csv.DictReader(handle)}


def normalize_historical_crashes(frame: pd.DataFrame) -> pd.DataFrame:
    result = pd.DataFrame(index=frame.index)
    result["crash_id"] = numeric(frame, "CRASH_CRN").astype("Int64")
    result["year"] = numeric(frame, "CRASH_YEAR").astype("Int16")
    result["month"] = numeric(frame, "CRASH_MONTH").astype("Int8")
    result["weekday"] = numeric(frame, "DAY_OF_WEEK").astype("Int8")
    result["time_of_day"] = numeric(frame, "TIME_OF_DAY").astype("Int32")
    result["hour"] = numeric(frame, "HOUR_OF_DAY").astype("Int8")
    result["latitude"] = numeric(frame, "DEC_LAT")
    result["longitude"] = numeric(frame, "DEC_LONG")
    result["municipality_code"] = numeric(frame, "MUNICIPALITY").astype("Int32")
    result["street_name"] = text(frame, "STREET_NAME")
    result["speed_limit"] = numeric(frame, "SPEED_LIMIT").astype("Int16")
    result["fatalities"] = numeric(frame, "FATAL_COUNT", 0).fillna(0).astype("Int16")
    result["injuries"] = (
        numeric(frame, "TOT_INJ_COUNT").fillna(numeric(frame, "INJURY_COUNT", 0)).astype("Int16")
    )
    result["serious_injuries"] = numeric(frame, "MAJ_INJ_COUNT", 0).fillna(0).astype("Int16")
    result["pedestrian_count"] = numeric(frame, "PED_COUNT", 0).fillna(0).astype("Int16")
    result["bicycle_count"] = numeric(frame, "BICYCLE_COUNT", 0).fillna(0).astype("Int16")
    result["vulnerable_road_user_count"] = (
        result["pedestrian_count"] + result["bicycle_count"]
    ).astype("Int16")
    result["vehicle_count"] = numeric(frame, "VEHICLE_COUNT", 0).fillna(0).astype("Int16")
    result["intersection_related"] = truthy(frame, "INTERSECTION")
    result["signalized_intersection"] = truthy(frame, "SIGNALIZED_INT")
    result["speeding_related"] = truthy(frame, "SPEEDING_RELATED") | truthy(frame, "SPEEDING")
    result["collision_type"] = numeric(frame, "COLLISION_TYPE").astype("Int16")
    result["weather_code"] = text(frame, "WEATHER")
    result["road_condition_code"] = text(frame, "ROAD_CONDITION")
    result["illumination_code"] = text(frame, "ILLUMINATION")
    result["source"] = "wprdc_crashes_cumulative_2004_2024"
    return result


def normalize_2025_crashes(frame: pd.DataFrame) -> pd.DataFrame:
    result = pd.DataFrame(index=frame.index)
    result["crash_id"] = numeric(frame, "CRN").astype("Int64")
    result["year"] = numeric(frame, "CRASH_YEAR").astype("Int16")
    result["month"] = numeric(frame, "CRASH_MONTH").astype("Int8")
    result["weekday"] = numeric(frame, "DAY_OF_WEEK").astype("Int8")
    result["time_of_day"] = numeric(frame, "TIME_OF_DAY").astype("Int32")
    result["hour"] = numeric(frame, "HOUR_OF_DAY").astype("Int8")
    result["latitude"] = numeric(frame, "DEC_LATITUDE")
    result["longitude"] = numeric(frame, "DEC_LONGITUDE")
    result["municipality_code"] = numeric(frame, "MUNICIPALITY").astype("Int32")
    result["street_name"] = pd.Series(pd.NA, index=frame.index, dtype="string")
    result["speed_limit"] = pd.Series(pd.NA, index=frame.index, dtype="Int16")
    result["fatalities"] = numeric(frame, "FATAL_COUNT", 0).fillna(0).astype("Int16")
    result["injuries"] = (
        numeric(frame, "TOT_INJ_COUNT").fillna(numeric(frame, "INJURY_COUNT", 0)).astype("Int16")
    )
    result["serious_injuries"] = (
        numeric(frame, "SUSP_SERIOUS_INJ_COUNT", 0).fillna(0).astype("Int16")
    )
    result["pedestrian_count"] = numeric(frame, "PED_COUNT", 0).fillna(0).astype("Int16")
    result["bicycle_count"] = numeric(frame, "BICYCLE_COUNT", 0).fillna(0).astype("Int16")
    result["vulnerable_road_user_count"] = (
        numeric(frame, "VULNERABLE_ROAD_USER_COUNT")
        .fillna(result["pedestrian_count"] + result["bicycle_count"])
        .astype("Int16")
    )
    result["vehicle_count"] = numeric(frame, "VEHICLE_COUNT", 0).fillna(0).astype("Int16")
    result["intersection_related"] = truthy(frame, "INTERSECTION_RELATED")
    result["signalized_intersection"] = False
    result["speeding_related"] = False
    result["collision_type"] = numeric(frame, "COLLISION_TYPE").astype("Int16")
    result["weather_code"] = text(frame, "WEATHER1")
    result["road_condition_code"] = text(frame, "ROAD_CONDITION")
    result["illumination_code"] = text(frame, "ILLUMINATION")
    result["source"] = "wprdc_crashes_2025"
    return result


def normalize_crashes(data_root: Path, municipalities: dict[int, str]) -> None:
    raw_root = data_root / "raw" / "wprdc" / "crashes"
    historical_columns = [
        "CRASH_CRN",
        "CRASH_YEAR",
        "CRASH_MONTH",
        "DAY_OF_WEEK",
        "TIME_OF_DAY",
        "HOUR_OF_DAY",
        "DEC_LAT",
        "DEC_LONG",
        "MUNICIPALITY",
        "STREET_NAME",
        "SPEED_LIMIT",
        "FATAL_COUNT",
        "TOT_INJ_COUNT",
        "INJURY_COUNT",
        "MAJ_INJ_COUNT",
        "PED_COUNT",
        "BICYCLE_COUNT",
        "VEHICLE_COUNT",
        "INTERSECTION",
        "SIGNALIZED_INT",
        "SPEEDING_RELATED",
        "SPEEDING",
        "COLLISION_TYPE",
        "WEATHER",
        "ROAD_CONDITION",
        "ILLUMINATION",
    ]
    current_columns = [
        "CRN",
        "CRASH_YEAR",
        "CRASH_MONTH",
        "DAY_OF_WEEK",
        "TIME_OF_DAY",
        "HOUR_OF_DAY",
        "DEC_LATITUDE",
        "DEC_LONGITUDE",
        "MUNICIPALITY",
        "FATAL_COUNT",
        "TOT_INJ_COUNT",
        "INJURY_COUNT",
        "SUSP_SERIOUS_INJ_COUNT",
        "PED_COUNT",
        "BICYCLE_COUNT",
        "VULNERABLE_ROAD_USER_COUNT",
        "VEHICLE_COUNT",
        "INTERSECTION_RELATED",
        "COLLISION_TYPE",
        "WEATHER1",
        "ROAD_CONDITION",
        "ILLUMINATION",
    ]
    historical = pd.read_csv(
        raw_root / "cumulative_2004_2024.csv",
        usecols=historical_columns,
        low_memory=False,
    )
    current = pd.read_csv(raw_root / "crashes_2025.csv", usecols=current_columns, low_memory=False)
    crashes = pd.concat(
        [normalize_historical_crashes(historical), normalize_2025_crashes(current)],
        ignore_index=True,
    )
    crashes = crashes.drop_duplicates("crash_id", keep="last")
    crashes["municipality_name"] = crashes["municipality_code"].map(municipalities).astype("string")
    valid_coordinates = crashes["latitude"].between(39, 42) & crashes["longitude"].between(-82, -78)
    geometry = gpd.points_from_xy(crashes["longitude"], crashes["latitude"])
    crash_geo = gpd.GeoDataFrame(crashes, geometry=geometry, crs="EPSG:4326")
    crash_geo.loc[~valid_coordinates, "geometry"] = None
    output = data_root / "normalized"
    crash_geo.to_parquet(output / "crash_events.parquet", index=False)
    crash_geo.loc[crash_geo["municipality_code"] == PITTSBURGH_MUNICIPALITY_CODE].to_parquet(
        output / "pittsburgh_crash_events.parquet", index=False
    )


def normalize_geojson(data_root: Path, source: str, destination: str) -> None:
    frame = gpd.read_file(data_root / source)
    frame.columns = [snake_case(column) for column in frame.columns]
    if frame.crs is None:
        frame = frame.set_crs("EPSG:4326")
    else:
        frame = frame.to_crs("EPSG:4326")
    frame.to_parquet(data_root / destination, index=False)


def seed_manual_inputs(data_root: Path) -> None:
    manual = data_root / "manual"
    manual.mkdir(exist_ok=True)
    destination = manual / "interventions.csv"
    if not destination.exists():
        shutil.copyfile(REPO_ROOT / "config" / "interventions.csv", destination)


def before_after(value: object) -> tuple[float | None, float | None]:
    value = "" if pd.isna(value) else str(value)
    before_match = re.search(r"Before:\s*([-+]?[\d,.]+)", value, flags=re.IGNORECASE)
    after_match = re.search(r"After:\s*([-+]?[\d,.]+)", value, flags=re.IGNORECASE)

    def parsed(match: re.Match[str] | None) -> float | None:
        return float(match.group(1).replace(",", "")) if match else None

    return parsed(before_match), parsed(after_match)


def split_location(value: object) -> tuple[str, str | None, str | None]:
    lines = [line.strip() for line in str(value).splitlines() if line.strip()]
    street = lines[0]
    if len(lines) < 2:
        return street, None, None
    match = re.match(r"From\s+(.+?)\s+to\s+(.+)$", lines[1], flags=re.IGNORECASE)
    if not match:
        return street, None, None
    return street, match.group(1), match.group(2)


def normalize_interventions(data_root: Path) -> None:
    source_url = (
        "https://www.pittsburghpa.gov/Resident-Services/Road-Maintenance/"
        "Road-Safety/Traffic-Calming/Traffic-Calming-Data"
    )
    raw = pd.read_csv(
        data_root / "raw" / "pittsburgh_domi" / "traffic_calming" / "traffic_calming.csv"
    )
    metric_columns = {
        "85th Percentile Speed (MPH)": ("p85_speed", "mph"),
        "% of Drivers Speeding": ("pct_speeding", "percent"),
        "Average Daily Trips (ADT)": ("adt", "vehicles_per_day"),
    }
    records: list[dict[str, object]] = []
    wide_records: list[dict[str, object]] = []
    identity_keys = (
        "study_id",
        "location_id",
        "street",
        "from_street",
        "to_street",
        "intervention_type",
        "location",
        "source_url",
    )
    for index, row in raw.iterrows():
        street, from_street, to_street = split_location(row["Street Name"])
        location_id = f"domi_traffic_calming_{index + 1:03d}"
        wide_record: dict[str, object] = {
            "study_id": "domi_traffic_calming",
            "location_id": location_id,
            "street": street,
            "from_street": from_street,
            "to_street": to_street,
            "intervention_type": snake_case(str(row["Project Type"])),
            "location": row.get("Location"),
            "source_url": source_url,
        }
        for source_column, (metric, unit) in metric_columns.items():
            before, after = before_after(row.get(source_column))
            wide_record[f"before_{metric}"] = before
            wide_record[f"after_{metric}"] = after
            if before is None or after is None:
                continue
            records.append(
                {
                    **{key: wide_record[key] for key in identity_keys},
                    "metric": metric,
                    "before_value": before,
                    "after_value": after,
                    "absolute_change": after - before,
                    "relative_change": (after - before) / before if before else None,
                    "unit": unit,
                    "before_period": None,
                    "after_period": None,
                }
            )
        wide_records.append(wide_record)

    manual = pd.read_csv(data_root / "manual" / "interventions.csv")
    manual_metrics = {
        "adt": "vehicles_per_day",
        "median_speed": "mph",
        "p85_speed": "mph",
        "pct_speeding": "percent",
        "max_speed": "mph",
    }
    for _, row in manual.iterrows():
        for metric, unit in manual_metrics.items():
            before = row.get(f"before_{metric}")
            after = row.get(f"after_{metric}")
            if pd.isna(before) or pd.isna(after):
                continue
            before_float = float(before)
            after_float = float(after)
            records.append(
                {
                    "study_id": row["study_id"],
                    "location_id": row["location_id"],
                    "street": row["street"],
                    "from_street": row["from_street"],
                    "to_street": row["to_street"],
                    "intervention_type": row["intervention_type"],
                    "location": None,
                    "source_url": row["source_url"],
                    "metric": metric,
                    "before_value": before_float,
                    "after_value": after_float,
                    "absolute_change": after_float - before_float,
                    "relative_change": (
                        (after_float - before_float) / before_float if before_float else None
                    ),
                    "unit": unit,
                    "before_period": row["before_period"],
                    "after_period": row["after_period"],
                }
            )

    normalized = data_root / "normalized"
    intervention_measurements = pd.DataFrame(records)
    intervention_measurements.to_parquet(
        normalized / "intervention_measurements.parquet", index=False
    )
    pd.DataFrame(wide_records).to_parquet(
        normalized / "traffic_calming_interventions.parquet", index=False
    )
    effects = (
        intervention_measurements.groupby(["intervention_type", "metric", "unit"])
        .agg(
            sample_size=("location_id", "nunique"),
            median_before=("before_value", "median"),
            median_after=("after_value", "median"),
            median_absolute_change=("absolute_change", "median"),
            median_relative_change=("relative_change", "median"),
        )
        .reset_index()
    )
    effects.to_parquet(data_root / "derived" / "intervention_effects.parquet", index=False)


def main() -> None:
    args = parse_args()
    normalized = args.data_root / "normalized"
    normalized.mkdir(parents=True, exist_ok=True)
    municipalities = read_municipalities(
        args.data_root / "raw" / "wprdc" / "crashes" / "municipality_codes.csv"
    )
    normalize_crashes(args.data_root, municipalities)
    mappings = [
        (
            "raw/wprdc/traffic_counts/traffic_counts.geojson",
            "normalized/traffic_counts.parquet",
        ),
        (
            "raw/wprdc/signals/signalized_intersections.geojson",
            "normalized/signals.parquet",
        ),
        (
            "raw/wprdc/intersection_markings/markings.geojson",
            "normalized/intersection_markings.parquet",
        ),
        (
            "raw/wprdc/intersection_markings/crosswalks.geojson",
            "normalized/crosswalks.parquet",
        ),
        (
            "raw/wprdc/high_injury_network/high_injury_network.geojson",
            "normalized/high_injury_segments.parquet",
        ),
    ]
    for source, destination in mappings:
        normalize_geojson(args.data_root, source, destination)
    seed_manual_inputs(args.data_root)
    normalize_interventions(args.data_root)
    print(f"Normalized datasets written to {normalized}")


if __name__ == "__main__":
    main()
