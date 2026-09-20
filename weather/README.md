# Interlock weather

Everything weather-related lives in this folder: the fetcher, the datasets it
produces, the behaviour profiles, the SUMO physics, and the tests.

```
weather/
├── fetch.py          download historical weather for the dates our data covers
├── normalize.py      build the joinable tables
├── model.py          profiles, vType physics, observed-frequency sampling
├── data/             derived CSVs (committed) + raw/ (gitignored)
└── tests/            20 tests, no SUMO and no network needed
```

```bash
python3 -m weather.fetch --list      # show what would be downloaded
python3 -m weather.fetch             # never overwrites without --force
python3 -m weather.normalize         # rebuild the derived tables
python3 -m unittest discover -s weather/tests -t .
```

## The data

Open-Meteo Historical Weather API (ERA5 reanalysis). **No API key.** Licensed
CC-BY 4.0; attribution is recorded in `data/catalog.yaml` and must be preserved
wherever these figures appear.

Fetched to match the dates Interlock actually has data for:

| Our data | Dates | Weather fetched |
| --- | --- | --- |
| `crash_events`, both MVP intersections | 2019-2025 | 2,557 days × 2 sites |
| `interventions.csv` Penn Ave before | 2021-12 | 31 days |
| `interventions.csv` Penn Ave after | 2026-04 | 30 days |

| File | Grain | Joins to |
| --- | --- | --- |
| `data/weather_daily.csv` | site × day | source for the others |
| `data/weather_monthly.csv` | site × year × month | `crash_events` on `(crash_year, crash_month)` |
| `data/weather_study_periods.csv` | day | the Penn Avenue study months |

**Why monthly is the join grain for crashes.** PennDOT suppresses exact crash
dates, so no weather source can ever be matched to an individual crash.
`crash_year` + `crash_month` is the finest shared grain. For conditions at the
moment of a crash, use `crash_events.weather_code` / `road_condition_code` /
`illumination_code`, which come from the crash report and remain the authority.

**A confound worth knowing.** `interventions.csv` compares Penn Avenue traffic
counts from December 2021 against April 2026:

| | wet days | freezing days | mean temp | daylight |
| --- | --- | --- | --- | --- |
| Before (2021-12) | 15 | 15 | 41.1°F | 9.3 h |
| After (2026-04) | 20 | 3 | 57.3°F | 13.3 h |

A four-hour daylight gap and twelve fewer freezing days. Any intervention effect
drawn from that before/after pair is partly seasonal.

## What weather does in the simulation

SUMO has no weather model, so conditions are applied as vehicle physics *before*
the run, never as a multiplier on the results.

| weather | speedFactor | decel | emergDecel | minGap | tau | sigma | friction |
| --- | --- | --- | --- | --- | --- | --- | --- |
| clear | 0.640 | 4.50 | 9.00 | 2.50 | 1.00 | 0.50 | 1.00 |
| rain | 0.595 | 3.83 | 5.40 | 2.75 | 1.10 | 0.55 | 0.60 |
| storm | 0.544 | 3.38 | 4.50 | 3.00 | 1.20 | 0.60 | 0.50 |
| snow | 0.480 | 2.03 | 2.25 | 3.38 | 1.35 | 0.65 | 0.25 |

The mechanism that matters is **stopping distance**. At 25 mph:

```
clear 18.1 m │ rain 22.7 m │ storm 25.1 m │ snow 38.9 m   (2.15x dry)
stop bar to crosswalk ~15 m
```

A vehicle that could stop short of the crosswalk on a dry road cannot on snow,
so `simulation.safety.detect_ttc_events` records shorter times-to-collision
against pedestrians and crossing traffic. The safety signal emerges from the run
rather than being asserted afterwards.

## Where the real data enters

`sample_condition` draws weather at the **observed frequency** for that
intersection and month, so a Monte Carlo campaign reproduces a real January
rather than an invented mix:

```
Fifth & Meyran, 2019-2025      clear   rain  storm   snow   freezing
  January                       46.5   19.4    0.0   34.1     78.8
  July                          37.8   62.2    0.0    0.0      0.0
```

```python
from weather import sample_condition
condition, exposure = sample_condition(rng, "fifth-meyran", month=1)
```

Returns `("clear", None)` when the data has not been built, so callers never
silently simulate invented weather.

## Honest limits

- **The behaviour multipliers are assumptions**, not Pittsburgh-calibrated
  values: Highway Capacity Manual weather adjustment factors for speed and
  capacity, standard tyre-road friction coefficients for deceleration. Each
  profile carries a `provenance` string saying so. Only the *frequencies* are
  measured.
- **Storm is never sampled** from observed data. ERA5's daily code for this
  location never reports thunderstorm (WMO 95-99) or fog (45-48) — only codes
  0-3, 51-65 and 71-75 appear, because sub-daily events are smoothed away by
  daily aggregation. `storm` remains available as an explicit scenario
  condition. Detecting storms needs the hourly endpoint.
- **Skidding, loss of control and visibility are not modelled.** Those are the
  dominant real winter crash mechanisms and SUMO does not represent them.
- **ERA5 is a coarse grid.** The returned grid point can sit several kilometres
  from the requested intersection, and both MVP intersections fall in nearly the
  same cell, so between-intersection weather differences are not meaningful.
  Requested and returned coordinates are both recorded in `data/catalog.yaml`.
- **No SUMO run has confirmed this end to end.** The pure functions are tested;
  nobody has yet verified that SUMO accepts the generated vType or that TTC
  events actually shift. Run `uv sync` first, then a clear and a snow scenario.

## Integration with the simulation

Two small hooks outside this folder, both importing from `weather`:

- `simulation/interventions.py` — `Scenario` carries `weather="clear"` and
  validates it
- `simulation/demand.py` — applies the profile to the vType and the pedestrian
  arrival rate

```python
Scenario("fifth-meyran", weather="snow")
```
