"""Manage the Interlock Tiger Data schema and baseline imports."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd
import psycopg
import yaml
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = REPO_ROOT / "data"
MIGRATIONS = REPO_ROOT / "db" / "migrations"
METRIC_CRS = "EPSG:26917"
DEMO_RUN_ID = uuid.UUID("5c7d61e3-d37d-52ad-9b6a-4b9450bbd57b")
DEMO_EVENT_NAMESPACE = uuid.UUID("073241b0-e421-5b98-a54d-f9e69b56278f")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("migrate", "load-baseline", "check", "seed-demo"),
    )
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    return parser.parse_args()


def connection(database_url: str | None) -> psycopg.Connection[Any]:
    if not database_url:
        raise SystemExit("DATABASE_URL is required; copy .env.example or pass --database-url")
    return psycopg.connect(database_url, autocommit=False, row_factory=dict_row)


def migrate(conn: psycopg.Connection[Any]) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            migration_name TEXT PRIMARY KEY,
            checksum TEXT NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    conn.commit()
    for migration in sorted(MIGRATIONS.glob("*.sql")):
        sql = migration.read_text(encoding="utf-8")
        checksum = hashlib.sha256(sql.encode()).hexdigest()
        existing = conn.execute(
            "SELECT checksum FROM schema_migrations WHERE migration_name = %s",
            (migration.name,),
        ).fetchone()
        if existing:
            if existing["checksum"] != checksum:
                raise RuntimeError(f"Applied migration changed: {migration.name}")
            print(f"existing  {migration.name}")
            continue
        with conn.transaction():
            conn.execute(sql, prepare=False)
            conn.execute(
                "INSERT INTO schema_migrations (migration_name, checksum) VALUES (%s, %s)",
                (migration.name, checksum),
            )
        print(f" applied  {migration.name}")


def python_value(value: Any) -> Any:
    if value is None or value is pd.NA or (not isinstance(value, str) and pd.isna(value)):
        return None
    if hasattr(value, "item"):
        return value.item()
    if isinstance(value, pd.Timestamp):
        return value.to_pydatetime()
    return value


def load_catalog(data_root: Path) -> tuple[dict[str, Any], dict[str, str]]:
    with (data_root / "catalog.yaml").open(encoding="utf-8") as handle:
        catalog = yaml.safe_load(handle)
    hashes = {source["id"]: source["sha256"] for source in catalog["sources"]}
    return catalog, hashes


def selected_intersections(data_root: Path) -> list[dict[str, Any]]:
    with (REPO_ROOT / "config" / "intersections.json").open(encoding="utf-8") as handle:
        selection = json.load(handle)["intersections"]
    candidates = gpd.read_parquet(data_root / "derived" / "intersection_candidates.parquet")
    by_id = candidates.set_index("candidate_id")
    selected = []
    for configured in selection:
        candidate = by_id.loc[configured["candidate_id"]]
        point = gpd.GeoSeries([candidate.geometry], crs=candidates.crs).to_crs("EPSG:4326").iloc[0]
        selected.append(
            {
                **configured,
                "signal_operation_type": candidate["operation_type"],
                "longitude": point.x,
                "latitude": point.y,
                "coverage_score": candidate["coverage_score_pre_osm"],
                "safety_priority_score": candidate["safety_priority_score"],
                "candidate": candidate,
                "metric_geometry": gpd.GeoSeries(
                    [candidate.geometry], crs=candidates.crs
                ).to_crs(METRIC_CRS).iloc[0],
            }
        )
    return selected


def insert_intersections(
    conn: psycopg.Connection[Any], selected: list[dict[str, Any]]
) -> None:
    query = """
        INSERT INTO intersections (
            intersection_id, candidate_id, name, signal_operation_type,
            longitude, latitude, coverage_score, safety_priority_score,
            selection_reason, source_metadata
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (intersection_id) DO UPDATE SET
            candidate_id = EXCLUDED.candidate_id,
            name = EXCLUDED.name,
            signal_operation_type = EXCLUDED.signal_operation_type,
            longitude = EXCLUDED.longitude,
            latitude = EXCLUDED.latitude,
            coverage_score = EXCLUDED.coverage_score,
            safety_priority_score = EXCLUDED.safety_priority_score,
            selection_reason = EXCLUDED.selection_reason,
            source_metadata = EXCLUDED.source_metadata
    """
    rows = [
        (
            item["id"],
            item["candidate_id"],
            item["name"],
            item["signal_operation_type"],
            item["longitude"],
            item["latitude"],
            item["coverage_score"],
            item["safety_priority_score"],
            item["reason"],
            Jsonb({"candidate_id": item["candidate_id"]}),
        )
        for item in selected
    ]
    conn.cursor().executemany(query, rows)


def nearby(
    observations: gpd.GeoDataFrame, selected: dict[str, Any], radius_m: float
) -> gpd.GeoDataFrame:
    metric = observations.to_crs(METRIC_CRS)
    return metric.loc[
        metric.geometry.distance(selected["metric_geometry"]) <= radius_m
    ].copy()


def insert_crashes(
    conn: psycopg.Connection[Any], data_root: Path, selected: list[dict[str, Any]]
) -> int:
    crashes = gpd.read_parquet(data_root / "normalized" / "pittsburgh_crash_events.parquet")
    crashes = crashes.loc[~crashes.geometry.is_empty]
    crashes = crashes.loc[crashes.geometry.notna()]
    columns = [
        "crash_id",
        "year",
        "month",
        "weekday",
        "hour",
        "longitude",
        "latitude",
        "street_name",
        "speed_limit",
        "fatalities",
        "injuries",
        "serious_injuries",
        "pedestrian_count",
        "bicycle_count",
        "vulnerable_road_user_count",
        "vehicle_count",
        "intersection_related",
        "signalized_intersection",
        "speeding_related",
        "collision_type",
        "weather_code",
        "road_condition_code",
        "illumination_code",
        "source",
    ]
    query = """
        INSERT INTO crash_events (
            crash_id, intersection_id, crash_year, crash_month, day_of_week,
            hour_of_day, longitude, latitude, street_name, speed_limit,
            fatalities, injuries, serious_injuries, pedestrian_count,
            bicycle_count, vulnerable_road_user_count, vehicle_count,
            intersection_related, signalized_intersection, speeding_related,
            collision_type, weather_code, road_condition_code, illumination_code,
            source_id
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s
        ) ON CONFLICT (crash_id, intersection_id) DO NOTHING
    """
    rows = []
    for intersection in selected:
        for values in nearby(crashes, intersection, 150)[columns].itertuples(index=False, name=None):
            rows.append((python_value(values[0]), intersection["id"], *map(python_value, values[1:])))
    conn.cursor().executemany(query, rows)
    return len(rows)


def insert_traffic(
    conn: psycopg.Connection[Any], data_root: Path, selected: list[dict[str, Any]]
) -> int:
    traffic = gpd.read_parquet(data_root / "normalized" / "traffic_counts.parquet")
    query = """
        INSERT INTO traffic_observations (
            observed_at, intersection_id, source_record_id, observation_end,
            counter_type, average_daily_car_traffic, average_daily_bike_traffic,
            median_speed_mph, p85_speed_mph, p95_speed_mph, percent_over_limit,
            speed_limit_mph, max_speed_mph, longitude, latitude
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        ) ON CONFLICT (observed_at, intersection_id, source_record_id) DO NOTHING
    """
    rows = []
    for intersection in selected:
        close = nearby(traffic, intersection, 200).to_crs("EPSG:4326")
        close = close.loc[close["count_start_date"].notna()]
        for row in close.itertuples(index=False):
            rows.append(
                (
                    python_value(row.count_start_date),
                    intersection["id"],
                    str(row.id),
                    python_value(row.count_end_date),
                    python_value(row.counter_type),
                    python_value(row.average_daily_car_traffic),
                    python_value(row.average_daily_bike_traffic),
                    python_value(row.median_speed),
                    python_value(row.speed85_percent),
                    python_value(row.speed95_percent),
                    python_value(row.percent_over_limit),
                    python_value(row.speed_limit),
                    python_value(row.max_speed),
                    row.geometry.x,
                    row.geometry.y,
                )
            )
    conn.cursor().executemany(query, rows)
    return len(rows)


def insert_road_design(
    conn: psycopg.Connection[Any],
    data_root: Path,
    selected: list[dict[str, Any]],
    hashes: dict[str, str],
) -> int:
    crosswalks = gpd.read_parquet(data_root / "normalized" / "crosswalks.parquet")
    hin = gpd.read_parquet(data_root / "normalized" / "high_injury_segments.parquet")
    source_ids = ("wprdc_signals", "wprdc_crosswalks", "wprdc_high_injury_network")
    source_version = hashlib.sha256("".join(hashes[key] for key in source_ids).encode()).hexdigest()
    observed_at = datetime.now(UTC)
    query = """
        INSERT INTO road_design_snapshots (
            intersection_id, source_version, observed_at, signal_operation_type,
            crosswalk_count, high_injury_network, high_injury_segment_count, attributes
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (intersection_id, source_version) DO NOTHING
    """
    rows = []
    for intersection in selected:
        crosswalk_count = len(nearby(crosswalks, intersection, 75))
        hin_count = len(nearby(hin, intersection, 50))
        rows.append(
            (
                intersection["id"],
                source_version,
                observed_at,
                intersection["signal_operation_type"],
                crosswalk_count,
                hin_count > 0,
                hin_count,
                Jsonb({"source_ids": source_ids}),
            )
        )
    conn.cursor().executemany(query, rows)
    return len(rows)


def insert_interventions(conn: psycopg.Connection[Any], data_root: Path) -> int:
    frame = pd.read_parquet(data_root / "normalized" / "intervention_measurements.parquet")
    study_query = """
        INSERT INTO intervention_studies (
            study_id, location_id, street, from_street, to_street,
            intervention_type, location_description, source_url,
            before_period, after_period
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (study_id, location_id) DO UPDATE SET
            street = EXCLUDED.street,
            from_street = EXCLUDED.from_street,
            to_street = EXCLUDED.to_street,
            intervention_type = EXCLUDED.intervention_type,
            location_description = EXCLUDED.location_description,
            source_url = EXCLUDED.source_url,
            before_period = EXCLUDED.before_period,
            after_period = EXCLUDED.after_period
    """
    identity = [
        "study_id",
        "location_id",
        "street",
        "from_street",
        "to_street",
        "intervention_type",
        "location",
        "source_url",
        "before_period",
        "after_period",
    ]
    studies = frame[identity].drop_duplicates(["study_id", "location_id"])
    conn.cursor().executemany(
        study_query,
        [tuple(map(python_value, values)) for values in studies.itertuples(index=False, name=None)],
    )
    measurement_query = """
        INSERT INTO intervention_measurements (
            study_id, location_id, metric, unit, before_value, after_value,
            absolute_change, relative_change
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (study_id, location_id, metric) DO UPDATE SET
            unit = EXCLUDED.unit,
            before_value = EXCLUDED.before_value,
            after_value = EXCLUDED.after_value,
            absolute_change = EXCLUDED.absolute_change,
            relative_change = EXCLUDED.relative_change
    """
    measurement_columns = [
        "study_id",
        "location_id",
        "metric",
        "unit",
        "before_value",
        "after_value",
        "absolute_change",
        "relative_change",
    ]
    conn.cursor().executemany(
        measurement_query,
        [
            tuple(map(python_value, values))
            for values in frame[measurement_columns].itertuples(index=False, name=None)
        ],
    )
    return len(frame)


def record_import(
    conn: psycopg.Connection[Any], source_id: str, source_hash: str, rows: int
) -> None:
    conn.execute(
        """
        INSERT INTO source_imports (source_id, source_sha256, row_count)
        VALUES (%s, %s, %s)
        ON CONFLICT (source_id, source_sha256) DO UPDATE SET
            imported_at = now(), row_count = EXCLUDED.row_count
        """,
        (source_id, source_hash, rows),
    )


def load_baseline(conn: psycopg.Connection[Any], data_root: Path) -> None:
    _, hashes = load_catalog(data_root)
    selected = selected_intersections(data_root)
    with conn.transaction():
        insert_intersections(conn, selected)
        crash_rows = insert_crashes(conn, data_root, selected)
        traffic_rows = insert_traffic(conn, data_root, selected)
        design_rows = insert_road_design(conn, data_root, selected, hashes)
        intervention_rows = insert_interventions(conn, data_root)
        record_import(
            conn,
            "normalized_crashes",
            hashlib.sha256(
                (
                    hashes["wprdc_crashes_cumulative_2004_2024"]
                    + hashes["wprdc_crashes_2025"]
                ).encode()
            ).hexdigest(),
            crash_rows,
        )
        record_import(conn, "wprdc_traffic_counts", hashes["wprdc_traffic_counts"], traffic_rows)
        record_import(conn, "road_design", hashes["wprdc_signals"], design_rows)
        record_import(
            conn,
            "intervention_measurements",
            hashes["domi_traffic_calming_csv"],
            intervention_rows,
        )
    print(
        f"loaded intersections={len(selected)} crashes={crash_rows} traffic={traffic_rows} "
        f"road_design={design_rows} intervention_measurements={intervention_rows}"
    )


def seed_demo(conn: psycopg.Connection[Any]) -> None:
    intersection_id = "fifth-meyran"
    run_id = DEMO_RUN_ID
    started = datetime.now(UTC).replace(microsecond=0)
    with conn.transaction():
        conn.execute(
            """
            DELETE FROM simulation_runs
            WHERE scenario_name = 'baseline-demo'
              AND simulation_config ->> 'demo' = 'true'
            """
        )
        conn.execute(
            """
            INSERT INTO simulation_runs (
                run_id, intersection_id, scenario_name, random_seed, status,
                started_at, completed_at, intervention_config, simulation_config
            ) VALUES (%s, %s, 'baseline-demo', 42, 'completed', %s, %s, %s, %s)
            """,
            (
                run_id,
                intersection_id,
                started,
                started + timedelta(seconds=120),
                Jsonb({}),
                Jsonb({"duration_s": 120, "demo": True}),
            ),
        )
        samples = []
        conflicts = []
        for second in range(120):
            simulated_at = started + timedelta(seconds=second)
            samples.append(
                (
                    simulated_at,
                    run_id,
                    intersection_id,
                    float(second),
                    8.5 + (second % 10) / 10,
                    13.0 + (second % 7) / 10,
                    4.0 + (second % 8) / 4,
                    2.0 + second % 5,
                    18 + second % 12,
                    3 + second % 4,
                    int(second % 6 == 0),
                    int(second % 15 == 0),
                )
            )
            if second % 17 == 0:
                conflicts.append(
                    (
                        simulated_at,
                        uuid.uuid5(DEMO_EVENT_NAMESPACE, str(second)),
                        run_id,
                        intersection_id,
                        float(second),
                        1.0 + (second % 4) * 0.5,
                        "vehicle-a",
                        "vehicle",
                        "pedestrian-b",
                        "pedestrian",
                        0.0,
                        0.0,
                        4.5,
                        Jsonb({"demo": True}),
                    )
                )
        conn.cursor().executemany(
            """
            INSERT INTO simulation_samples VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            """,
            samples,
        )
        conn.cursor().executemany(
            """
            INSERT INTO ttc_events VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            """,
            conflicts,
        )
    conn.autocommit = True
    try:
        conn.execute("CALL refresh_continuous_aggregate('simulation_metrics_1s', NULL, NULL)")
        conn.execute("CALL refresh_continuous_aggregate('ttc_events_1s', NULL, NULL)")
    finally:
        conn.autocommit = False
    print(f"seeded demo run {run_id} with {len(samples)} samples and {len(conflicts)} TTC events")


def check(conn: psycopg.Connection[Any]) -> None:
    extension = conn.execute(
        "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'"
    ).fetchone()
    if not extension:
        raise RuntimeError("timescaledb extension is not installed")
    counts = {}
    for table in (
        "intersections",
        "crash_events",
        "traffic_observations",
        "intervention_measurements",
        "simulation_runs",
        "simulation_samples",
        "vehicle_states",
        "ttc_events",
    ):
        counts[table] = conn.execute(f"SELECT count(*) AS count FROM {table}").fetchone()["count"]
    hypertables = conn.execute(
        """
        SELECT hypertable_name
        FROM timescaledb_information.hypertables
        WHERE hypertable_schema = 'public'
        ORDER BY hypertable_name
        """
    ).fetchall()
    aggregates = conn.execute(
        """
        SELECT view_name
        FROM timescaledb_information.continuous_aggregates
        WHERE view_schema = 'public'
        ORDER BY view_name
        """
    ).fetchall()
    print(f"timescaledb={extension['extversion']}")
    print("hypertables=" + ",".join(row["hypertable_name"] for row in hypertables))
    print("continuous_aggregates=" + ",".join(row["view_name"] for row in aggregates))
    for table, count in counts.items():
        print(f"{table}={count}")


def main() -> int:
    args = parse_args()
    try:
        with connection(args.database_url) as conn:
            if args.command == "migrate":
                migrate(conn)
            elif args.command == "load-baseline":
                load_baseline(conn, args.data_root)
            elif args.command == "seed-demo":
                seed_demo(conn)
            elif args.command == "check":
                check(conn)
    except psycopg.Error as exc:
        print(f"database error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
