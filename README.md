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

## Tiger Data

The database layer uses standard PostgreSQL plus the TimescaleDB extension, so the same migrations
run against Tiger Cloud and the local development container. Copy `.env.example` to `.env`, then
either keep the local URL or replace it with the Tiger Cloud service URL (including
`sslmode=require`).

```bash
docker compose up -d
set -a; source .env; set +a
uv run python scripts/tiger.py migrate
uv run python scripts/tiger.py load-baseline
uv run python scripts/tiger.py seed-demo
uv run python scripts/tiger.py check
```

The selected MVP intersections are declared in `config/intersections.json`. Historical crash rows
remain relational because PennDOT suppresses exact dates; observed traffic, simulation samples,
and TTC conflicts are Timescale hypertables. Reusable analysis queries live in `db/queries/`.
