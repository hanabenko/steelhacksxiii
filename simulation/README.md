# Interlock simulation engine

This package runs SUMO scenarios for Fifth Avenue and Meyran Avenue, records raw vehicle telemetry
and per-second aggregates in Tiger Data, detects vehicle–vehicle and vehicle–pedestrian
constant-velocity time-to-collision (TTC) events, and supports matched-seed Monte Carlo comparisons.

The network is a 500-meter OpenStreetMap extract converted with SUMO `netconvert`. Baseline demand
uses Tiger Data observation `428229895`: 382 ADT, 16 mph median speed, 20 mph 85th-percentile speed,
and a 25 mph speed limit. The observation is a nearby side-street counter, so it is treated as a
conservative average-hour demand rather than a complete intersection turning count.

## Architecture

- `engine.py` owns one TraCI run and exposes `run_scenario()` for future API callers.
- `models.py` contains stable result and telemetry types.
- `network.py` downloads/builds the OSM network and identifies valid Fifth/Meyran movements.
- `demand.py` creates seeded Poisson arrivals and observed-speed driver parameters.
- `safety.py` computes TTC and filters implausible/diverging vehicle pairs.
- `metrics.py` computes per-run and Monte Carlo distributions without database coupling.
- `database.py` reuses the project's existing PostgreSQL connection helper and existing tables.
- `interventions.py` defines `Scenario`, `SpeedLimitChange`, and `SignalTimingChange`.
- `api.py` is the stable JSON-serializable boundary for game/backend callers.
- `signals.py` maps game-friendly signal allocations onto SUMO signal phases.
- `monte_carlo.py` runs independently seeded repetitions.
- `compare.py` runs baseline and intervention scenarios with identical seed lists.
- `frontend_contract.py` translates the supported frontend request subset into
  truthful SUMO scenario states without importing game scoring or Three.js concepts.

No Monte Carlo summary table is needed: every individual run is persisted in the existing schema,
and aggregate distributions are returned as JSON. Per-run summary metrics are also stored under
`simulation_runs.simulation_config.metrics`.

## Install and configure

The project includes `eclipse-sumo`, `traci`, and `sumolib`:

```bash
uv sync
```

Set `DATABASE_URL` to the Tiger Cloud PostgreSQL URL. Keep passwords in `.env`, the Tiger CLI
keyring, or a secret manager—not in source control.

```bash
set -a; source .env; set +a
uv run python scripts/tiger.py migrate
```

To use the Tiger CLI keyring without writing a password to disk:

```bash
INTERLOCK_TIGER_URL="$(tiger db connection-string --with-password)"
export DATABASE_URL="$INTERLOCK_TIGER_URL"
```

## One baseline run

```bash
uv run python simulation/run.py --intersection fifth-meyran --seed 42
```

Useful options include `--duration 900`, `--gui`, `--keep-output`, configurable thresholds such as
`--ttc-thresholds 1.0,2.5,4.0`, and a modified scenario such as `--speed-limit 20`.

Python callers can avoid the CLI:

```python
from simulation.engine import run_scenario
from simulation.interventions import Scenario

result = run_scenario(
    Scenario(intersection_id="fifth-meyran", interventions=[]),
    seed=42,
    database_url=database_url,
)
```

Game/backend code should use the package-level public interface instead:

```python
from simulation import simulate_scenario

result = simulate_scenario(
    intersection_id="fifth-meyran",
    interventions=[],
    runs=100,
    seed=42,
)
```

The returned dictionary is directly JSON-serializable. It contains the normalized scenario,
aggregate distributions (mean, median, standard deviation, p5, p25, p75, and p95), separate safety
summaries, deterministic seeds, and persisted Tiger run IDs. Intervention dictionaries are also
accepted, for example `{"type": "signal_timing", "main_green_s": 45,
"side_green_s": 25}`.

## Baseline-state contract

Frontend and game callers that need aggregates plus an immediately playable replay should use:

```python
from simulation import get_baseline_state

baseline = get_baseline_state(
    intersection_id="fifth-meyran",
    runs=50,
    seed=42,
)
```

The JSON-serializable result has four main sections:

- `intersection`: stable identity, street names, map center, and scenario configuration;
- `aggregate_metrics`: Monte Carlo distributions and separate vehicle–vehicle and
  vehicle–pedestrian safety summaries;
- `representative_run`: a persisted run ID, seed, metrics, selection metadata, and plain replay
  frames containing vehicle and pedestrian agents;
- `assumptions`: duration, seed list, configurable TTC thresholds, pedestrian-demand assumption,
  and replay provenance.

The representative replay is never an averaged or fabricated trajectory. For each run, the engine
forms a vector from speed, throughput/completions, delay, pedestrian wait/completions, and both TTC
event-count categories. It calculates the cross-run median of each metric, normalizes differences by
that metric's observed range, and selects the real run with the smallest Euclidean distance. Ties
are resolved by seed and then run ID, making selection deterministic.

Vehicle replay coordinates come from the existing Tiger `vehicle_states` rows; headings are derived
from consecutive coordinates because that table does not store headings. Pedestrian positions and
headings are captured in a temporary compressed simulation artifact, merged into the representative
replay, and then discarded. No Three.js concepts or database records appear in replay frames.

The completed state is atomically cached under ignored `simulation/cache/scenario_states/` using a
key that includes the scenario, run count, seed, duration, TTC thresholds, and pedestrian demand.
Repeated calls load that file without SUMO or Tiger access. Pass `force_refresh=True` to regenerate
it intentionally. `get_scenario_state(...)` provides the same shape for modified scenarios, so a
future game layer can pair baseline and intervention states without changing its replay renderer.

Precompute or intentionally refresh the default cache during development/deployment with:

```bash
uv run python -m simulation.baseline \
  --intersection fifth-meyran \
  --runs 50 \
  --seed 42 \
  --force-refresh
```

## Frontend integration contract

The simulation-owned adapter currently supports one shared frontend/SUMO target:
**Forbes Avenue & Bigelow Boulevard** (`pitt-forbes-bigelow`). Its checked-in OSM
source, SUMO network, stable target junction, traffic-light ID, edge/lane lists, and
approach mapping live under `simulation/networks/pitt-forbes-bigelow/`. This imported
junction has incoming north (Bigelow), south (Schenley), and west (Forbes) approaches.
Its east Forbes leg is outbound-only, so a request that requires an eastbound approach
intervention must be rejected by a future geometry intervention implementation.

Use the package API; no caller needs TraCI, Tiger Data, or SUMO file paths:

```python
from simulation import simulate_frontend_scenario

result = simulate_frontend_scenario(
    {
        "schemaVersion": 2,
        "intersection": "pitt-forbes-bigelow",
        "seed": 42,
        "settings": {"runs": 50, "demand": 120, "green": 35, "av": 0},
        "upgrades": [{"type": "signal", "zone": "west"}],
    }
)
```

Successful results have `contract_version: 1` and contain `intersection`, `baseline`,
`modified`, `delta`, `matched_seeds`, `assumptions`, and `translation`. Both scenarios
contain explicit-unit physical distributions and a replay selected from a real persisted
SUMO run. Replay payloads include one-second frames, WGS84 coordinates plus raw SUMO
meters, stable vehicle/pedestrian IDs, signal-state timelines, and TTC conflict-event
timelines. They deliberately contain no Three.js projection, game score, budget,
objective, or pedestrian-access index.

`settings.demand` is a deterministic vehicle-arrival override in vehicles/hour. Omit it
to retain the cached observation-calibrated baseline. Forbes/Bigelow does not yet have a
complete local traffic-count record in Tiger Data, so its calibrated default explicitly
uses the existing Fifth/Meyran observation until local calibration is loaded; this
provenance is returned as an assumption and is not presented as Forbes/Bigelow data.

Only smart-signal and internal speed-limit changes are supported. The legacy frontend
`signal` upgrade maps to `SignalTimingChange`; with only `settings.green`, the adapter
uses that duration for both principal green phases. Raised crosswalks, bike lanes, curb
extensions, road diets, and any AV percentage greater than zero return a JSON error with
an explicit code such as `unsupported_intervention` or `unsupported_av_behavior`. They
are never silently ignored.

For an unmodified request, the adapter reuses `get_baseline_state(...)` and its cache.
For a modified request, baseline and modified scenarios share the same deterministic
per-run seed list. TTC output is labeled as a constant-velocity simulation conflict
surrogate—not a predicted crash count.

## TTC analysis

For each nearby vehicle pair, `safety.py` derives relative position and relative velocity and solves
for the first future time their constant-velocity trajectories enter a configurable collision
envelope. Pairs that are diverging, have no relative motion, or miss the envelope at closest
approach are ignored. TTC is a simulation conflict proxy, not a universal declaration that a
particular threshold is dangerous.

The minimum TTC observation for each actor pair is written to the existing `ttc_events`
hypertable, so a multi-second encounter is counted once rather than once per simulation step. The
default thresholds are 1.5 and 3.0 seconds, but they are configuration values and may be replaced
per run. Vehicle–vehicle and vehicle–pedestrian counts and minima remain separate in results.
Both calculations use the same configurable planar collision envelope and constant-velocity
projection; actor dimensions and evasive reactions are not modeled by this proxy.

## Pedestrians

The SUMO network is built with pedestrian sidewalks, walking areas, and OSM-derived crossings.
Pedestrian arrivals use an independent seeded Poisson process, so baseline and intervention runs
receive identical people and crossing choices for matched seeds. Until a trustworthy local count is
available, the default of 60 pedestrians/hour is an explicit configurable assumption—not an
observed Pittsburgh measurement. Override it with `pedestrians_per_hour=` in Python or
`--pedestrians-per-hour` in the CLIs.

Completed crossings, active pedestrians, stationary waiting seconds, mean/p95 wait, positions used
for safety calculations, and vehicle–pedestrian TTC conflicts are tracked. Raw pedestrian positions
are held in memory for conflict detection; aggregate pedestrian values use the existing
`simulation_samples` columns, while conflicts use the existing `ttc_events` actor-type columns.

## Monte Carlo

```bash
uv run python simulation/monte_carlo.py \
  --intersection fifth-meyran \
  --runs 100 \
  --seed 42
```

The base seed deterministically creates unique per-run seeds. Each seed changes Poisson arrival
times, movement selection, SUMO's observed-speed distribution draws, and SUMO's standard stochastic
driver imperfection. The output reports mean, median, population standard deviation, p5, p25, p75,
and p95 plus the proportion of runs containing an event below each TTC threshold.

## Matched scenario comparison

The implemented intervention changes the calibrated vehicle type's maximum speed and rescales the
observed desired-speed distribution to preserve the baseline speed-to-posted-limit ratio. It does
not edit OSM geometry. Both sides use the same seed list and therefore the same arrival and route
draws.

```bash
uv run python simulation/compare.py \
  --intersection fifth-meyran \
  --runs 100 \
  --seed 42 \
  --speed-limit 20
```

The returned JSON contains `baseline`, `intervention`, and `delta`, including mean speed,
throughput, average delay, pedestrian crossings/wait, and both categories of low-TTC-event
differences.

Fifth/Meyran has a usable static SUMO signal program. The pedestrian-capable OSM import represents
the physical intersection as a joined signal controller with two principal vehicle-green phases,
yellow/clearance phases, and pedestrian phases. `SignalTimingChange` changes only the two principal
green durations; it preserves clearance and pedestrian phases.

```bash
uv run python simulation/compare.py \
  --intersection fifth-meyran \
  --runs 100 \
  --seed 42 \
  --main-green 45 \
  --side-green 25
```

Or use the public matched interface:

```python
from simulation import compare_scenario_configs

comparison = compare_scenario_configs(
    "fifth-meyran",
    baseline_interventions=[],
    modified_interventions=[
        {"type": "signal_timing", "main_green_s": 45, "side_green_s": 25}
    ],
    runs=100,
    seed=42,
)
```

## Metrics and persistence

Every successful run produces:

- mean and median vehicle speed from timestamped vehicle observations;
- vehicles completed and hourly-equivalent throughput;
- average final per-vehicle SUMO time loss;
- minimum TTC and event counts below every configured threshold;
- one row per second in `simulation_samples`;
- one row per active vehicle per second in `vehicle_states`;
- detected conflicts in `ttc_events`.
- completed pedestrian crossings and active pedestrian counts in `simulation_samples`;
- mean/p95 pedestrian wait and vehicle–pedestrian TTC distributions in run metrics.

OpenStreetMap data is © OpenStreetMap contributors and licensed under ODbL.
