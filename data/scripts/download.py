#!/usr/bin/env python3
"""Download only explicit, official public AV artifacts described in manifests."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFESTS = ROOT / "manifests"
CHUNK_BYTES = 1024 * 1024


def load_manifests(selected: set[str] | None) -> list[dict]:
    records = []
    for path in sorted(MANIFESTS.glob("*.json")):
        if path.name == "index.json":
            continue
        record = json.loads(path.read_text(encoding="utf-8"))
        if selected is None or record["id"] in selected:
            records.append(record)
    return records


def digest(path: Path, algorithm: str) -> str:
    value = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK_BYTES), b""):
            value.update(chunk)
    return value.hexdigest()


def valid(path: Path, artifact: dict) -> bool:
    if not path.is_file():
        return False
    expected_bytes = artifact.get("bytes")
    if expected_bytes is not None and path.stat().st_size != expected_bytes:
        return False
    checksum = artifact.get("checksum")
    if checksum:
        algorithm, expected = checksum.split(":", 1)
        return digest(path, algorithm) == expected
    return True


def download(url: str, destination: Path, artifact: dict) -> None:
    temporary = destination.with_suffix(destination.suffix + ".part")
    if temporary.exists():
        print(f"  removing incomplete temporary file: {temporary.name}")
        temporary.unlink()
    request = urllib.request.Request(url, headers={"User-Agent": "Interlock-AV-Data-Pipeline/1.0"})
    print(f"  downloading {destination.name}")
    with urllib.request.urlopen(request) as response, temporary.open("wb") as output:
        advertised = response.headers.get("Content-Length")
        total = int(advertised) if advertised and advertised.isdigit() else artifact.get("bytes")
        written = 0
        while chunk := response.read(CHUNK_BYTES):
            output.write(chunk)
            written += len(chunk)
            if total:
                print(f"\r    {written / 2**30:.2f}/{total / 2**30:.2f} GiB", end="", flush=True)
    print()
    if not valid(temporary, artifact):
        temporary.unlink(missing_ok=True)
        raise RuntimeError(f"Verification failed for {destination.name}; partial file removed.")
    os.replace(temporary, destination)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", action="append", choices=["argoverse2", "argoverse1", "denso", "cmu", "penndot"], help="Limit to one source (repeatable).")
    parser.add_argument("--full", action="store_true", help="Also download full-only artifacts, including the 57.44 GiB AV2 collection.")
    parser.add_argument("--sample", action="store_true", help="Include official sample artifacts where available for smoke tests.")
    parser.add_argument("--dry-run", action="store_true", help="Print the acquisition plan without network activity.")
    args = parser.parse_args()
    records = load_manifests(set(args.dataset) if args.dataset else None)
    for record in records:
        print(f"{record['id']}: {record['name']} [{record['status']}]")
        artifacts = record.get("artifacts", [])
        if record["status"] != "downloadable":
            print(f"  no automated download: {record['required_credentials']}")
            continue
        target = ROOT / "sources" / record["id"] / "downloads"
        for artifact in artifacts:
            if args.sample and not args.full and not (artifact.get("sample_only") or artifact.get("include_sample")):
                print(f"  not needed for sample: {artifact['filename']}")
                continue
            if artifact.get("full_only") and not args.full:
                print(f"  full-only (use --full): {artifact['filename']}")
                continue
            if artifact.get("sample_only") and not (args.sample or args.full):
                print(f"  sample-only (use --sample): {artifact['filename']}")
                continue
            path = target / artifact["filename"]
            if valid(path, artifact):
                print(f"  already verified: {path.name}")
                continue
            if args.dry_run:
                print(f"  would download: {artifact['download_url']} -> {path}")
                continue
            target.mkdir(parents=True, exist_ok=True)
            try:
                download(artifact["download_url"], path, artifact)
            except Exception as error:  # Keep remaining public sources actionable.
                print(f"  ERROR {path.name}: {error}", file=sys.stderr)
                return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
