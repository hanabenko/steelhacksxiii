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

## Autonomous-vehicle calibration sources

`sources/`, `manifests/`, `metadata/`, and `scripts/` form a separate, data-only
pipeline for future AV-behavior calibration. It does not alter simulation, Tiger
Data, frontend code, or existing city-data artifacts. Large downloads and extracted
files remain local and are ignored by Git.

| Source | Status | Why it is included | Approximate download storage |
| --- | --- | --- | --- |
| Argoverse 2 Motion Forecasting | Public, full-only | Excellent multi-agent trajectories plus local HD maps, but no official mini release was found. | 57.44 GiB archives; never downloaded by default |
| Argoverse 1.1 Motion Forecasting | Public, default | Pittsburgh/Miami trajectories plus maps; validation is sufficient for distribution estimates. | 645 MiB default; about 1.5 GiB extracted |
| DENSO Pittsburgh Innovation Lab | Restricted | Pittsburgh routes, vehicle dynamics, and labels are described, but no official archive/license is public. | Not published |
| CMU scenario database project | Restricted | Pittsburgh interaction-scenario project; public reports, no released dataset archive. | Not applicable |
| PennDOT certificate holders | Reference only | AV-testing context, not trajectories; no structured public endpoint was found. | Not applicable |

### Why this is deliberately small

Interlock needs representative behavioral statistics for SUMO—not a perception
training corpus. We use trajectories to estimate speed distributions, headway,
acceleration/braking, turn/lane-change rates, pedestrian interactions, and
trajectory smoothness. The default therefore downloads only AV1.1 validation plus
HD maps. It is large enough to produce distributions but small enough for a
hackathon laptop. The five-scenario official sample is only a smoke-test fixture,
not a reliable calibration set. AV2 has useful richer tracks, but no official
lightweight subset was found and is reserved for explicit research use.

The public Argoverse selections are deliberately motion-forecasting datasets only.
They have trajectory/map information relevant to SUMO calibration; this repository
does not process LiDAR or imagery. Argoverse data is CC BY-NC-SA 4.0, so verify
that the intended use meets its non-commercial and attribution requirements.

### Commands

From the repository root:

```bash
# Show exactly what would be acquired; no network transfer.
python data/scripts/download.py --dry-run

# Download only the AV1.1 validation-plus-maps calibration bundle (~645 MiB).
python data/scripts/download.py

# Download the official five-scenario AV1 smoke-test sample plus maps.
python data/scripts/download.py --dataset argoverse1 --sample

# Explicitly opt into all public AV1 and AV2 motion archives (~62 GiB).
python data/scripts/download.py --full

# Limit an explicit large transfer to one source.
python data/scripts/download.py --dataset argoverse2 --full

# Validate JSON manifests and any local artifacts, then extract safely.
python data/scripts/verify.py
python data/scripts/extract.py

# Regenerate concise source summaries from tracked manifests.
python data/scripts/summarize.py
```

The downloader is idempotent: an existing file is skipped only when its recorded
size (and checksum, if a publisher supplies one) verifies. Full-only artifacts
are listed but never transferred without `--full`. It uses only explicit official
direct-download URLs recorded in `manifests/`; it does not crawl or scrape
websites. DENSO and CMU print their contact/access instructions instead of
failing, while PennDOT is intentionally not scraped because no structured source
was identified.

Each manifest records source URL, version, license, citation, download size,
credentials/access condition, local path, and calibration summary. The per-source
READMEs under `sources/` are the human-facing counterpart.
