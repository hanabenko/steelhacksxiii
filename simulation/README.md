# Interlock SUMO baseline

This integration imports a 500-meter OpenStreetMap extract around Fifth Avenue and Meyran
Avenue, converts it with SUMO `netconvert`, generates baseline trips through the closest junction,
and runs the scenario one second at a time through TraCI.

The baseline is calibrated from Tiger Data's `traffic_observations` record for `fifth-meyran`:
382 average daily vehicles, 16 mph median speed, 20 mph 85th-percentile speed, and a 25 mph speed
limit. Because this is a nearby side-street counter rather than a full turning-count study, it is
used as a conservative average-hour demand rather than claimed as an intersection-wide volume.

## Install

The project includes the official `eclipse-sumo`, `traci`, and `sumolib` Python packages, which
supply the SUMO binaries, TraCI client, network reader, and `netconvert`:

```bash
uv sync
```

Alternatively, install the official macOS SUMO package and ensure `sumo` and `netconvert` are on
`PATH`. `sumo-gui` on macOS also needs XQuartz.

## Database

Set `DATABASE_URL` to the Tiger Cloud PostgreSQL connection string. Keep the password in your local
`.env` or secret manager; never commit it.

```bash
set -a; source .env; set +a
uv run python scripts/tiger.py migrate
```

If you use the Tiger CLI keyring, you can inject the connection string without writing the password
to disk:

```bash
INTERLOCK_TIGER_URL="$(tiger db connection-string --with-password)"
DATABASE_URL="$INTERLOCK_TIGER_URL" uv run python simulation/run.py \
  --intersection fifth-meyran --seed 42
unset INTERLOCK_TIGER_URL
```

Migration `003_vehicle_states.sql` adds the one table not present in the initial schema: a
hypertable for timestamped per-vehicle position, speed, and acceleration. Existing
`simulation_runs` and `simulation_samples` tables store run metadata and per-second aggregates.

## Run

```bash
set -a; source .env; set +a
uv run python simulation/run.py --intersection fifth-meyran --seed 42
```

The first run downloads the local OSM extract and builds `network.net.xml`. Use
`--rebuild-network` to refresh it, `--duration 900` for a shorter smoke test, `--gui` to open
SUMO's graphical interface, or `--keep-output` to retain the generated route file.

Each successful run writes:

- one row to `simulation_runs`;
- one aggregate row per simulated second to `simulation_samples`;
- one row per active vehicle per second to `vehicle_states`.

OpenStreetMap data is © OpenStreetMap contributors and licensed under ODbL.
