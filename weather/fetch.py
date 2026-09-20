"""Fetch historical weather for the dates Interlock actually has data for.

Weather supplements two dated things in this project:

1. **Crash records (2019-2025).** PennDOT suppresses exact crash dates, so a
   crash row can never be joined to a specific day's weather. What it can join
   to is `crash_year` + `crash_month`, so this script builds a monthly
   climatology per intersection: how wet, snowy, cold and dark each month was.
   That supports "were the bad months also the wet months" without ever
   implying a per-crash weather lookup. The per-crash conditions you already
   have live in `crash_events.weather_code` and remain the authority for
   "what was the weather at this crash".

2. **Intervention studies.** `data/manual/interventions.csv` records Penn
   Avenue before/after traffic counts taken in 2021-12 and 2026-04. The data
   catalog already warns that "average daily trips may be affected by weather
   and holidays", so this script pulls the daily weather for exactly those
   study months, making that confound measurable instead of hypothetical.

Source: Open-Meteo Historical Weather API (ERA5 reanalysis). No API key, free
for non-commercial use, licensed CC-BY 4.0.

    python3 -m weather.fetch --list
    python3 -m weather.fetch
    python3 -m weather.fetch --force

Existing raw files are never overwritten unless --force is supplied, matching
scripts/fetch_data.py.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import yaml

WEATHER_DIR = Path(__file__).resolve().parent
REPO_ROOT = WEATHER_DIR.parent
DEFAULT_DATA_ROOT = WEATHER_DIR / "data"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
USER_AGENT = "InterlockDataPipeline/0.1 (+https://github.com/hanabenko/steelhacksxiii)"
LICENSE = "CC-BY 4.0 (Open-Meteo, ERA5 / Copernicus)"
ATTRIBUTION = "Weather data by Open-Meteo.com, ERA5 reanalysis (Copernicus Climate Change Service)"

# Daily variables chosen for traffic relevance, not general meteorology.
DAILY_VARIABLES = [
    "weather_code",
    "temperature_2m_mean",
    "temperature_2m_min",
    "precipitation_sum",
    "rain_sum",
    "snowfall_sum",
    "precipitation_hours",
    "wind_speed_10m_max",
    "daylight_duration",
]

# WMO weather codes grouped into the categories the game already models.
# Mirrors frontend/src/scenarios.js so derived figures can drive those presets.
WMO_GROUPS: dict[str, tuple[int, ...]] = {
    "clear": (0, 1),
    "cloud": (2, 3),
    "fog": (45, 48),
    "rain": (51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82),
    "snow": (71, 73, 75, 77, 85, 86),
    "storm": (95, 96, 99),
}


def wmo_group(code: Any) -> str:
    try:
        value = int(code)
    except (TypeError, ValueError):
        return "unknown"
    for name, codes in WMO_GROUPS.items():
        if value in codes:
            return name
    return "unknown"


# --- What we have dates for ------------------------------------------------

SITES: list[dict[str, Any]] = [
    {
        "id": "fifth-meyran",
        "name": "Fifth Avenue / Meyran Avenue",
        "latitude": 40.441163,
        "longitude": -79.959277,
        "start": "2019-01-01",
        "end": "2025-12-31",
        "covers": "crash_events window 2019-2025",
    },
    {
        "id": "atlantic-baum-liberty",
        "name": "Atlantic Avenue / Baum Boulevard / Liberty Avenue",
        "latitude": 40.456635,
        "longitude": -79.939643,
        "start": "2019-01-01",
        "end": "2025-12-31",
        "covers": "crash_events window 2019-2025",
    },
    {
        # Penn Avenue Rightsizing study corridor, Strip District. A single
        # representative point: the study's two segments are ~500 m apart and
        # fall inside one reanalysis grid cell.
        "id": "penn-corridor-study",
        "name": "Penn Avenue Rightsizing study corridor",
        "latitude": 40.451693,
        "longitude": -79.983131,
        "start": "2021-12-01",
        "end": "2021-12-31",
        "covers": "interventions.csv before_period 2021-12",
    },
    {
        "id": "penn-corridor-study",
        "name": "Penn Avenue Rightsizing study corridor",
        "latitude": 40.451693,
        "longitude": -79.983131,
        "start": "2026-04-01",
        "end": "2026-04-30",
        "covers": "interventions.csv after_period 2026-04",
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--force", action="store_true", help="Replace existing raw files.")
    parser.add_argument("--list", action="store_true", help="Show requests without fetching.")
    parser.add_argument("--timeout", type=float, default=60.0)
    return parser.parse_args()


def request_key(site: dict[str, Any]) -> str:
    return f"{site['id']}_{site['start'][:7].replace('-', '')}_{site['end'][:7].replace('-', '')}"


def fetch_site(site: dict[str, Any], destination: Path, force: bool, timeout: float) -> dict:
    """Download one site-window. Returns catalog metadata."""
    if destination.exists() and not force:
        payload = json.loads(destination.read_text(encoding="utf-8"))
        return {"status": "existing", "days": len(payload.get("daily", {}).get("time", []))}

    query = urlencode(
        {
            "latitude": site["latitude"],
            "longitude": site["longitude"],
            "start_date": site["start"],
            "end_date": site["end"],
            "daily": ",".join(DAILY_VARIABLES),
            "timezone": "America/New_York",
            "temperature_unit": "fahrenheit",
            "precipitation_unit": "inch",
            "wind_speed_unit": "mph",
        }
    )
    url = f"{ARCHIVE_URL}?{query}"
    request = Request(url, headers={"User-Agent": USER_AGENT})

    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read()
    except HTTPError as error:
        raise RuntimeError(f"{site['id']} {site['start']}: HTTP {error.code} {error.reason}") from error
    except URLError as error:
        raise RuntimeError(f"{site['id']} {site['start']}: {error.reason}") from error

    payload = json.loads(body)
    if "error" in payload:
        raise RuntimeError(f"{site['id']}: Open-Meteo error: {payload.get('reason')}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(body)

    return {
        "status": "fetched",
        "days": len(payload.get("daily", {}).get("time", [])),
        "grid_latitude": payload.get("latitude"),
        "grid_longitude": payload.get("longitude"),
        "elevation_m": payload.get("elevation"),
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
        "url": url,
    }


def main() -> int:
    args = parse_args()
    raw_root = args.data_root / "raw"

    if args.list:
        for site in SITES:
            print(f"{site['id']:24} {site['start']} -> {site['end']}   {site['covers']}")
        return 0

    records: list[dict[str, Any]] = []
    failures = 0

    for index, site in enumerate(SITES):
        destination = raw_root / f"{request_key(site)}.json"
        try:
            result = fetch_site(site, destination, args.force, args.timeout)
        except RuntimeError as error:
            print(f"FAILED  {error}", file=sys.stderr)
            failures += 1
            continue

        print(
            f"{result['status']:8} {site['id']:24} {site['start']}..{site['end']}  "
            f"{result['days']} days"
        )
        records.append(
            {
                "id": f"open_meteo_{request_key(site)}",
                "site_id": site["id"],
                "site_name": site["name"],
                "requested_latitude": site["latitude"],
                "requested_longitude": site["longitude"],
                "start_date": site["start"],
                "end_date": site["end"],
                "covers": site["covers"],
                "path": str(destination.relative_to(args.data_root)),
                "publisher": "Open-Meteo",
                "dataset": "Historical Weather API (ERA5 reanalysis)",
                "landing_page": "https://open-meteo.com/en/docs/historical-weather-api",
                "license": LICENSE,
                "attribution": ATTRIBUTION,
                "retrieved_at": datetime.now(UTC).isoformat(),
                "known_limitations": [
                    "ERA5 reanalysis on a coarse grid; the returned grid point can sit "
                    "several kilometers from the requested intersection.",
                    "Both MVP intersections fall in nearly the same grid cell, so "
                    "between-intersection weather differences are not meaningful.",
                    "Reanalysis estimates conditions; it is not a gauge reading at the "
                    "intersection.",
                    "Cannot be joined to individual crashes: PennDOT suppresses exact "
                    "crash dates. Use crash_events.weather_code for per-crash conditions.",
                ],
                **{k: v for k, v in result.items() if k not in {"status", "days"}},
            }
        )
        # Courtesy pacing for a free public API.
        if index < len(SITES) - 1 and result["status"] == "fetched":
            time.sleep(1.0)

    if records:
        catalog_path = args.data_root / "catalog.yaml"
        catalog_path.write_text(
            yaml.safe_dump(
                {
                    "schema_version": 1,
                    "generated_at": datetime.now(UTC).isoformat(),
                    "attribution": ATTRIBUTION,
                    "requests": records,
                },
                sort_keys=False,
                allow_unicode=True,
            ),
            encoding="utf-8",
        )
        print(f"\nWrote {catalog_path.relative_to(REPO_ROOT)}")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
