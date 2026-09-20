#!/usr/bin/env python3
"""Extract downloaded AV archives without conversion or unsafe archive paths."""

from __future__ import annotations

import argparse
import json
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def safe_target(root: Path, member: str) -> Path:
    target = (root / member).resolve()
    if root.resolve() not in target.parents and target != root.resolve():
        raise ValueError(f"unsafe archive member: {member}")
    return target


def extract_archive(path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    if tarfile.is_tarfile(path):
        with tarfile.open(path) as archive:
            members = archive.getmembers()
            for member in members:
                safe_target(destination, member.name)
            archive.extractall(destination, members=members, filter="data")
        return
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            for member in archive.infolist():
                safe_target(destination, member.filename)
            archive.extractall(destination)
        return
    raise ValueError(f"unsupported archive: {path.name}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", action="append", choices=["argoverse2", "argoverse1", "denso", "cmu", "penndot"])
    args = parser.parse_args()
    selected = set(args.dataset) if args.dataset else None
    for manifest_path in sorted((ROOT / "manifests").glob("*.json")):
        if manifest_path.name == "index.json":
            continue
        record = json.loads(manifest_path.read_text(encoding="utf-8"))
        if selected and record["id"] not in selected:
            continue
        for artifact in record.get("artifacts", []):
            archive = ROOT / "sources" / record["id"] / "downloads" / artifact["filename"]
            if not archive.exists():
                print(f"{record['id']}: absent, skip {archive.name}")
                continue
            target = ROOT / "sources" / record["id"] / "extracted" / artifact["name"]
            marker = target / ".interlock-extracted"
            if marker.exists():
                print(f"{record['id']}: already extracted {artifact['name']}")
                continue
            print(f"{record['id']}: extracting {archive.name}")
            extract_archive(archive, target)
            marker.write_text(f"source={archive.name}\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
