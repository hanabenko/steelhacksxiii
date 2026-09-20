#!/usr/bin/env python3
"""Validate tracked AV manifests and any local downloaded artifacts."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def checksum(path: Path, algorithm: str) -> str:
    value = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def main() -> int:
    failed = False
    for manifest_path in sorted((ROOT / "manifests").glob("*.json")):
        if manifest_path.name == "index.json":
            continue
        try:
            record = json.loads(manifest_path.read_text(encoding="utf-8"))
            required = {"id", "name", "source_url", "download_url", "license", "size", "estimated_extracted_size", "recommended_for_hackathon", "status", "local_path", "notes", "artifacts"}
            missing = required - record.keys()
            if missing:
                raise ValueError(f"missing fields: {', '.join(sorted(missing))}")
            print(f"{record['id']}: manifest OK")
            for artifact in record["artifacts"]:
                path = ROOT / "sources" / record["id"] / "downloads" / artifact["filename"]
                if not path.exists():
                    print(f"  absent (not downloaded): {artifact['filename']}")
                    continue
                if "bytes" in artifact and path.stat().st_size != artifact["bytes"]:
                    raise ValueError(f"wrong size for {path.name}")
                if artifact.get("checksum"):
                    algorithm, expected = artifact["checksum"].split(":", 1)
                    if checksum(path, algorithm) != expected:
                        raise ValueError(f"checksum mismatch for {path.name}")
                print(f"  verified: {artifact['filename']}")
        except Exception as error:
            failed = True
            print(f"{manifest_path.name}: ERROR {error}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
