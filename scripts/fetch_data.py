"""Fetch immutable Interlock source data and record reproducibility metadata."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = REPO_ROOT / "config" / "data_sources.json"
DEFAULT_DATA_ROOT = REPO_ROOT / "data"
USER_AGENT = "InterlockDataPipeline/0.1 (+https://data.wprdc.org/)"
SAFE_RESPONSE_HEADERS = {
    "content-disposition",
    "content-length",
    "content-type",
    "etag",
    "last-modified",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument(
        "--source",
        action="append",
        help="Source ID to fetch. Repeatable. Defaults to every enabled source.",
    )
    parser.add_argument("--include-optional", action="store_true")
    parser.add_argument("--force", action="store_true", help="Replace existing raw files.")
    parser.add_argument(
        "--list", action="store_true", help="List selected sources without fetching."
    )
    return parser.parse_args()


def load_config(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def selected_sources(config: dict[str, Any], args: argparse.Namespace) -> list[dict[str, Any]]:
    sources = config["sources"]
    if args.source:
        by_id = {source["id"]: source for source in sources}
        missing = sorted(set(args.source) - set(by_id))
        if missing:
            raise SystemExit(f"Unknown source ID(s): {', '.join(missing)}")
        return [by_id[source_id] for source_id in args.source]
    return [source for source in sources if source["enabled"] or args.include_optional]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(source: dict[str, Any], destination: Path, force: bool) -> dict[str, Any]:
    url = source.get("url")
    if not url:
        raise ValueError("source has no verified resource URL")
    if destination.exists() and not force:
        return {
            "status": "existing",
            "bytes": destination.stat().st_size,
            "sha256": sha256(destination),
        }

    destination.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={"User-Agent": USER_AGENT})
    temp_path: Path | None = None
    try:
        with (
            urlopen(request, timeout=120) as response,
            tempfile.NamedTemporaryFile(
                dir=destination.parent,
                prefix=f".{destination.name}.",
                suffix=".part",
                delete=False,
            ) as temp,
        ):
            temp_path = Path(temp.name)
            shutil.copyfileobj(response, temp)
            headers = {
                key.lower(): value
                for key, value in response.headers.items()
                if key.lower() in SAFE_RESPONSE_HEADERS
            }
            final_url = response.url
        os.replace(temp_path, destination)
        return {
            "status": "downloaded",
            "bytes": destination.stat().st_size,
            "sha256": sha256(destination),
            "final_url": final_url,
            "response_headers": headers,
        }
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink()


def write_workspace_readme(data_root: Path) -> None:
    readme = data_root / "README.md"
    if readme.exists():
        return
    readme.write_text(
        """# Interlock data workspace

This directory contains external source data and generated artifacts for Interlock.

- `raw/` contains immutable downloads. Never edit these files in place.
- `manual/` contains small, human-curated tables with row-level provenance.
- `normalized/` contains consistently typed and projected datasets.
- `derived/` contains rebuildable features and rankings.
- `scenarios/` contains per-intersection map and SUMO artifacts.

`catalog.yaml` records source URLs, checksums, retrieval timestamps, licensing, and known
limitations. Run `uv run python scripts/fetch_data.py` from the project repository to fetch
enabled sources. Existing raw files are not overwritten unless `--force` is supplied.
""",
        encoding="utf-8",
    )


def load_catalog_records(data_root: Path) -> dict[str, dict[str, Any]]:
    path = data_root / "catalog.yaml"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        existing = yaml.safe_load(handle) or {}
    return {record["id"]: record for record in existing.get("sources", [])}


def write_catalog(data_root: Path, records: dict[str, dict[str, Any]]) -> None:
    catalog = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "data_root": str(data_root.resolve()),
        "sources": sorted(records.values(), key=lambda record: record["id"]),
    }
    with (data_root / "catalog.yaml").open("w", encoding="utf-8") as handle:
        yaml.safe_dump(catalog, handle, sort_keys=False, allow_unicode=True)


def main() -> int:
    args = parse_args()
    config = load_config(args.config)
    sources = selected_sources(config, args)

    if args.list:
        for source in sources:
            state = "enabled" if source["enabled"] else "optional"
            print(f"{source['id']}: {state} -> {source['path']}")
        return 0

    args.data_root.mkdir(parents=True, exist_ok=True)
    write_workspace_readme(args.data_root)
    for directory in ("raw", "manual", "normalized", "derived", "scenarios"):
        (args.data_root / directory).mkdir(exist_ok=True)

    records = load_catalog_records(args.data_root)
    failures = 0
    for source in sources:
        record = dict(source)
        destination = args.data_root / source["path"]
        record["retrieved_at"] = datetime.now(UTC).isoformat()
        try:
            result = fetch(source, destination, args.force)
            record.update(result)
            print(f"{result['status']:>10}  {source['id']}  {destination}")
        except (HTTPError, URLError, TimeoutError, ValueError) as exc:
            failures += 1
            record["status"] = "failed"
            record["error"] = str(exc)
            print(f"    failed  {source['id']}: {exc}", file=sys.stderr)
        records[source["id"]] = record
        write_catalog(args.data_root, records)

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
