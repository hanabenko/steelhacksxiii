# Interlock

Interlock is a 3D traffic-optimization game built on real Pittsburgh data. Players redesign
real intersections under a limited budget, then run Monte Carlo SUMO simulations to balance
safety, throughput, pedestrian access, and cost.

## Data pipeline

Source definitions live in [`config/data_sources.json`](config/data_sources.json). Raw, normalized,
and derived datasets live directly in the repository's `data/` directory.
Large reproducible artifacts under `data/raw`, `data/normalized`, and `data/scenarios` are ignored
by Git because the cumulative crash CSV exceeds GitHub's standard single-file size limit.

```bash
uv sync
uv run python scripts/fetch_data.py --list
uv run python scripts/fetch_data.py
uv run python scripts/normalize_data.py
uv run python scripts/rank_intersections.py
uv run python scripts/fetch_osm.py
uv run python scripts/validate_data.py
```

The fetcher never overwrites a raw file unless `--force` is explicitly supplied. It records source
URLs, checksums, retrieval timestamps, licenses, and known limitations in `data/catalog.yaml`.
