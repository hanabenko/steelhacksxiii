# Interlock

Interlock is a 3D traffic-optimization game built on real Pittsburgh data. Players redesign
real intersections under a limited budget, then run Monte Carlo SUMO simulations to balance
safety, throughput, pedestrian access, and cost.

## Run the connected app

The app server connects the frontend to the existing Gemini and ElevenLabs services.
API keys stay on the server. In two terminals from the repository root:

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-app.txt
.venv/Scripts/python -m uvicorn app_server:app --host 127.0.0.1 --port 8080
```

```powershell
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite. `/api` is proxied to port 8080. For a built app,
run `npm run build` in `frontend` before starting the app server, then open
http://127.0.0.1:8080. A deployed frontend needs the same `/api` reverse proxy
(or `VITE_APP_API_URL` and an appropriately configured server origin).

Set `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, and `ELEVENLABS_VOICE_ID` in the root
`.env` (see `.env.example`). Missing Gemini credentials produce a labeled offline
explanation. Voice failures preserve the text answer. The Street assistant supports
typed questions, microphone transcription, design coaching, and optional spoken
replies. Microphone access requires localhost or HTTPS and browser permission.

Both the free simulation and the game evaluate the current campus design in a worker,
show progress, and start 100× traffic/day-night playback. Pause and speed controls
remain available. These campus results are explicitly uncalibrated local estimates.

The separate **SUMO · Forbes / Bigelow signal study** uses the actual Python engine,
database observations, matched seeds, physical metrics, and a representative vehicle/
pedestrian replay. It compares original signals with the green-phase slider, using
the demand slider, for 3 trials of 10 simulated minutes. It does not apply campus
upgrades or weather that SUMO does not yet model. Install the root `pyproject.toml`
dependencies and follow the Tiger Data setup below, with `DATABASE_URL` in `.env`,
to enable it. Missing database configuration produces an actionable error.

For the smaller local SUMO setup, without downloading the full crash archive:

```powershell
docker compose up -d
.venv/Scripts/python scripts/fetch_data.py --source wprdc_traffic_counts
.venv/Scripts/python scripts/setup_app_database.py
```

This imports real traffic observations and the checked-in intersection selection;
it does not invent historical crash data. A new SUMO study may take a few minutes;
the frontend continues its fast traffic preview while the server runs, and matching
studies reuse cached results. Restart the app server after changing `.env`.

Verification:

```powershell
.venv/Scripts/python -m pytest tests
.venv/Scripts/python -m pytest gemini/tests
.venv/Scripts/python -m pytest voice/tests
cd frontend
npm test
npm run build
$env:PLAYWRIGHT_CHANNEL='chrome' # or install Playwright Chromium
npm run test:e2e -- --workers=2
```

Gemini and voice suites run separately because their standalone tests both import
a top-level package named `app`.

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
