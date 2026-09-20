#!/usr/bin/env python3
"""Render short tracked summaries from manifests; never inspect sensor payloads."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    for path in sorted((ROOT / "manifests").glob("*.json")):
        if path.name == "index.json":
            continue
        item = json.loads(path.read_text(encoding="utf-8"))
        fields = item.get("calibration_fields") or ["No structured behavioral fields available from this reference."]
        body = "\n".join([
            f"# {item['name']} — summary",
            "",
            f"Generated from `data/manifests/{path.name}` on {date.today().isoformat()}.",
            "",
            f"- Status: `{item['status']}`",
            f"- Recommended for hackathon: {item['recommended_for_hackathon']}",
            f"- Download storage: {item['size']}",
            f"- Extracted storage: {item['estimated_extracted_size']}",
            f"- Geographic coverage: {item['geographic_coverage']}",
            f"- Pittsburgh coverage: {item['pittsburgh_coverage']}",
            f"- Summary: {item['summary']}",
            "- Useful SUMO-calibration fields:",
            *[f"  - {field}" for field in fields],
            f"- Notes: {item['notes']}",
            "",
        ])
        target = ROOT / "sources" / item["id"] / "SUMMARY.md"
        target.write_text(body, encoding="utf-8")
        print(f"wrote {target.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
