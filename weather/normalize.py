"""Turn raw Open-Meteo responses into tables that join to Interlock's data.

Produces three artifacts in weather/data/:

  weather_daily.csv          one row per site per day, with the WMO code mapped
                             to the game's weather categories
  weather_monthly.csv        one row per site per year-month. This is the grain
                             that joins to crash_events, because PennDOT
                             publishes crash_year and crash_month but suppresses
                             the day
  weather_study_periods.csv  daily weather for the Penn Avenue before/after
                             traffic-count months, so the catalog's "average
                             daily trips may be affected by weather" caveat
                             becomes a measurable comparison

    python3 -m weather.normalize
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

WEATHER_DIR = Path(__file__).resolve().parent
REPO_ROOT = WEATHER_DIR.parent
DEFAULT_DATA_ROOT = WEATHER_DIR / "data"

import sys

sys.path.insert(0, str(REPO_ROOT))
from weather.fetch import wmo_group  # noqa: E402

# A day counts as "wet" / "snowy" once it passes a threshold that plausibly
# changes driving, rather than any trace amount.
RAIN_INCH = 0.01
SNOW_INCH = 0.1
FREEZING_F = 32.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    return parser.parse_args()


def load_raw(raw_root: Path) -> list[tuple[str, dict[str, Any]]]:
    rows: list[tuple[str, dict[str, Any]]] = []
    for path in sorted(raw_root.glob("*.json")):
        site_id = path.stem.rsplit("_", 2)[0]
        rows.append((site_id, json.loads(path.read_text(encoding="utf-8"))))
    return rows


def daily_records(raw: list[tuple[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for site_id, payload in raw:
        daily = payload.get("daily") or {}
        times = daily.get("time") or []
        for index, day in enumerate(times):

            def value(name: str) -> Any:
                series = daily.get(name) or []
                return series[index] if index < len(series) else None

            code = value("weather_code")
            rain = value("rain_sum") or 0.0
            snow = value("snowfall_sum") or 0.0
            temp_min = value("temperature_2m_min")
            daylight = value("daylight_duration")
            records.append(
                {
                    "site_id": site_id,
                    "date": day,
                    "year": int(day[:4]),
                    "month": int(day[5:7]),
                    "weather_code": code,
                    "weather_group": wmo_group(code),
                    "temp_mean_f": value("temperature_2m_mean"),
                    "temp_min_f": temp_min,
                    "precipitation_in": value("precipitation_sum"),
                    "rain_in": rain,
                    "snowfall_in": snow,
                    "precipitation_hours": value("precipitation_hours"),
                    "wind_max_mph": value("wind_speed_10m_max"),
                    "daylight_hours": round(daylight / 3600, 2) if daylight else None,
                    "is_wet_day": int(rain >= RAIN_INCH),
                    "is_snow_day": int(snow >= SNOW_INCH),
                    "is_freezing_day": int(temp_min is not None and temp_min <= FREEZING_F),
                }
            )
    return records


def monthly_records(daily: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[tuple[str, int, int], list[dict[str, Any]]] = defaultdict(list)
    for row in daily:
        buckets[(row["site_id"], row["year"], row["month"])].append(row)

    def mean(rows: list[dict[str, Any]], key: str) -> float | None:
        values = [r[key] for r in rows if r[key] is not None]
        return round(sum(values) / len(values), 2) if values else None

    out: list[dict[str, Any]] = []
    for (site_id, year, month), rows in sorted(buckets.items()):
        days = len(rows)
        groups = defaultdict(int)
        for row in rows:
            groups[row["weather_group"]] += 1
        out.append(
            {
                "site_id": site_id,
                "year": year,
                "month": month,
                "days": days,
                "wet_days": sum(r["is_wet_day"] for r in rows),
                "snow_days": sum(r["is_snow_day"] for r in rows),
                "freezing_days": sum(r["is_freezing_day"] for r in rows),
                "storm_days": groups.get("storm", 0),
                "fog_days": groups.get("fog", 0),
                "clear_days": groups.get("clear", 0),
                "wet_day_share": round(sum(r["is_wet_day"] for r in rows) / days, 3),
                "precipitation_in": round(
                    sum(r["precipitation_in"] or 0.0 for r in rows), 2
                ),
                "snowfall_in": round(sum(r["snowfall_in"] or 0.0 for r in rows), 2),
                "temp_mean_f": mean(rows, "temp_mean_f"),
                "daylight_hours_mean": mean(rows, "daylight_hours"),
            }
        )
    return out


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    args = parse_args()
    raw_root = args.data_root / "raw"
    if not raw_root.is_dir():
        print("No raw weather found. Run python3 -m weather.fetch first.", file=sys.stderr)
        return 1

    derived = args.data_root
    daily = daily_records(load_raw(raw_root))
    monthly = monthly_records(daily)
    study = [row for row in daily if row["site_id"] == "penn-corridor-study"]

    write_csv(derived / "weather_daily.csv", daily)
    write_csv(derived / "weather_monthly.csv", monthly)
    write_csv(derived / "weather_study_periods.csv", study)

    print(f"weather_daily.csv          {len(daily):>5} rows")
    print(f"weather_monthly.csv        {len(monthly):>5} rows")
    print(f"weather_study_periods.csv  {len(study):>5} rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
