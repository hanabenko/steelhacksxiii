"""Validate Interlock data integrity, schemas, and geospatial outputs."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import geopandas as gpd
import pandas as pd
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = REPO_ROOT / "data"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"ok  {message}")


def main() -> None:
    args = parse_args()
    with (args.data_root / "catalog.yaml").open(encoding="utf-8") as handle:
        catalog = yaml.safe_load(handle)
    with (REPO_ROOT / "config" / "data_sources.json").open(encoding="utf-8") as handle:
        source_config = json.load(handle)
    enabled = [source for source in catalog["sources"] if source.get("enabled")]
    require(bool(enabled), "catalog contains enabled sources")
    expected_ids = {source["id"] for source in source_config["sources"] if source.get("enabled")}
    catalog_ids = {source["id"] for source in enabled}
    require(catalog_ids == expected_ids, "catalog contains every enabled configured source")
    for source in enabled:
        require(source["status"] in {"downloaded", "existing"}, f"{source['id']} was fetched")
        path = args.data_root / source["path"]
        require(path.exists() and path.stat().st_size > 0, f"{source['id']} raw file is non-empty")
        require(sha256(path) == source["sha256"], f"{source['id']} checksum matches catalog")

    crashes = gpd.read_parquet(args.data_root / "normalized" / "crash_events.parquet")
    require(len(crashes) >= 250_000, "normalized crash history contains at least 250,000 events")
    require(crashes["crash_id"].is_unique, "normalized crash IDs are unique")
    require(crashes["year"].min() == 2004, "crash history starts in 2004")
    require(crashes["year"].max() == 2025, "crash history includes 2025")
    require(crashes.crs.to_epsg() == 4326, "crash geometry uses EPSG:4326")

    pittsburgh = gpd.read_parquet(args.data_root / "normalized" / "pittsburgh_crash_events.parquet")
    require(
        set(pittsburgh["municipality_code"].dropna().astype(int)) == {2301},
        "Pittsburgh crash subset uses municipality code 2301",
    )

    candidates = gpd.read_parquet(args.data_root / "derived" / "intersection_candidates.parquet")
    require(len(candidates) >= 700, "ranking contains at least 700 valid signal candidates")
    require(candidates.geometry.is_valid.all(), "candidate geometries are valid")
    require(candidates["candidate_id"].is_unique, "candidate IDs are unique")

    interventions = pd.read_parquet(
        args.data_root / "normalized" / "intervention_measurements.parquet"
    )
    require(len(interventions) > 10, "intervention evidence contains parsed measurements")
    require(
        {"adt", "p85_speed", "pct_speeding"}.issubset(set(interventions["metric"])),
        "intervention evidence includes volume and speed metrics",
    )

    shortlist = pd.read_csv(args.data_root / "derived" / "osm_shortlist.csv")
    require(len(shortlist) == 3, "OSM shortlist contains three intersections")
    require((shortlist["highway_ways"] > 0).all(), "each OSM extract contains highway geometry")


if __name__ == "__main__":
    main()
