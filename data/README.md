# Interlock data workspace

This directory contains external source data and generated artifacts for Interlock.

- `raw/` contains immutable downloads. Never edit these files in place.
- `manual/` contains small, human-curated tables with row-level provenance.
- `normalized/` contains consistently typed and projected datasets.
- `derived/` contains rebuildable features and rankings.
- `scenarios/` contains per-intersection map and SUMO artifacts.

`catalog.yaml` records source URLs, checksums, retrieval timestamps, licensing, and known
limitations. Run `uv run python scripts/fetch_data.py` from the project repository to fetch
enabled sources. Existing raw files are not overwritten unless `--force` is supplied.
