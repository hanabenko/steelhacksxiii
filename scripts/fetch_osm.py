"""Fetch small OpenStreetMap extracts for separated top-ranked intersections."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import tempfile
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import Request, urlopen

import geopandas as gpd
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = REPO_ROOT / "data"
METRIC_CRS = "EPSG:26917"
USER_AGENT = "InterlockDataPipeline/0.1 (SteelHacks XIII student project)"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--count", type=int, default=3)
    parser.add_argument("--radius-m", type=float, default=450)
    parser.add_argument("--min-separation-m", type=float, default=750)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def slugify(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return value[:80] or "intersection"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def choose_candidates(
    candidates: gpd.GeoDataFrame, count: int, min_separation_m: float
) -> gpd.GeoDataFrame:
    selected_indices: list[int] = []
    for index, candidate in candidates.iterrows():
        if all(
            candidate.geometry.distance(candidates.loc[chosen].geometry) >= min_separation_m
            for chosen in selected_indices
        ):
            selected_indices.append(index)
        if len(selected_indices) == count:
            break
    return candidates.loc[selected_indices].copy()


def inspect_osm(path: Path) -> dict[str, int]:
    root = ET.parse(path).getroot()
    if root.tag != "osm":
        raise ValueError(f"Unexpected XML root: {root.tag}")
    counts = {
        "nodes": 0,
        "ways": 0,
        "relations": 0,
        "highway_ways": 0,
        "ways_with_lanes": 0,
        "ways_with_maxspeed": 0,
        "ways_with_oneway": 0,
        "traffic_signal_nodes": 0,
        "crossing_nodes": 0,
        "turn_restrictions": 0,
    }
    for element in root:
        if element.tag == "node":
            counts["nodes"] += 1
        elif element.tag == "way":
            counts["ways"] += 1
        elif element.tag == "relation":
            counts["relations"] += 1
        tags = {tag.attrib["k"]: tag.attrib["v"] for tag in element.findall("tag")}
        if element.tag == "way" and "highway" in tags:
            counts["highway_ways"] += 1
            counts["ways_with_lanes"] += int("lanes" in tags)
            counts["ways_with_maxspeed"] += int("maxspeed" in tags)
            counts["ways_with_oneway"] += int("oneway" in tags)
        if element.tag == "node":
            counts["traffic_signal_nodes"] += int(tags.get("highway") == "traffic_signals")
            counts["crossing_nodes"] += int(tags.get("highway") == "crossing")
        if element.tag == "relation":
            counts["turn_restrictions"] += int(tags.get("type") == "restriction")
    return counts


def download(url: str, destination: Path, force: bool) -> str:
    if destination.exists() and not force:
        return "existing"
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={"User-Agent": USER_AGENT})
    temp_path: Path | None = None
    try:
        with (
            urlopen(request, timeout=180) as response,
            tempfile.NamedTemporaryFile(
                dir=destination.parent,
                prefix=f".{destination.name}.",
                suffix=".part",
                delete=False,
            ) as temp,
        ):
            temp_path = Path(temp.name)
            shutil.copyfileobj(response, temp)
        os.replace(temp_path, destination)
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink()
    return "downloaded"


def main() -> None:
    args = parse_args()
    candidates = gpd.read_parquet(
        args.data_root / "derived" / "intersection_candidates.parquet"
    ).to_crs(METRIC_CRS)
    shortlist = choose_candidates(candidates, args.count, args.min_separation_m)
    shortlist_wgs84 = shortlist.to_crs("EPSG:4326")
    rows: list[dict[str, object]] = []
    for metric_index, candidate in shortlist.iterrows():
        bounds = (
            gpd.GeoSeries([candidate.geometry.buffer(args.radius_m)], crs=METRIC_CRS)
            .to_crs("EPSG:4326")
            .total_bounds
        )
        west, south, east, north = (round(value, 7) for value in bounds)
        bbox = [west, south, east, north]
        url = "https://api.openstreetmap.org/api/0.6/map?bbox=" + ",".join(map(str, bbox))
        description = str(candidate["description"])
        slug = slugify(description)
        directory = args.data_root / "raw" / "osm" / "intersections" / slug
        osm_path = directory / "source.osm.xml"
        status = download(url, osm_path, args.force)
        assessment = inspect_osm(osm_path)
        point = shortlist_wgs84.loc[metric_index].geometry
        request_metadata = {
            "candidate_id": candidate["candidate_id"],
            "description": description,
            "center": {"longitude": point.x, "latitude": point.y},
            "radius_m": args.radius_m,
            "bbox_wgs84": bbox,
            "request_url": url,
            "retrieved_at": datetime.now(UTC).isoformat(),
            "license": "Open Data Commons Open Database License (ODbL)",
            "attribution": "© OpenStreetMap contributors",
            "bytes": osm_path.stat().st_size,
            "sha256": sha256(osm_path),
            "assessment": assessment,
        }
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "request.json").write_text(
            json.dumps(request_metadata, indent=2) + "\n", encoding="utf-8"
        )
        rows.append({**request_metadata, **assessment, "path": str(osm_path), "status": status})
        print(f"{status:>10}  {description}: {assessment['highway_ways']} highway ways")
    serializable_rows = []
    for row in rows:
        serialized = dict(row)
        serialized["bbox_wgs84"] = json.dumps(serialized["bbox_wgs84"])
        serialized["center"] = json.dumps(serialized["center"])
        serialized["assessment"] = json.dumps(serialized["assessment"])
        serializable_rows.append(serialized)
    pd.DataFrame(serializable_rows).to_csv(
        args.data_root / "derived" / "osm_shortlist.csv", index=False
    )


if __name__ == "__main__":
    main()
