# Argoverse 1.1 Motion Forecasting Dataset — summary

Generated from `data/manifests/argoverse1.json` on 2026-09-20.

- Status: `downloadable`
- Recommended for hackathon: yes
- Download storage: 645 MiB default; 4.79 GiB with --full
- Extracted storage: About 1.5 GiB for the default bundle; reserve 10 GiB for the full release.
- Geographic coverage: Miami and Pittsburgh; 86 linear km of Pittsburgh lane coverage documented by Argoverse.
- Pittsburgh coverage: Yes: Downtown, Strip District, and Lower Lawrenceville are documented Pittsburgh areas.
- Summary: The default bundle is the 10 Hz validation split plus official HD maps: enough tracks to estimate distributions and interaction proxies without downloading training data. A separate five-scenario sample is retained for smoke tests. The full 324,557-scenario release remains available with --full.
- Useful SUMO-calibration fields:
  - object trajectories
  - timestamps
  - agent/AV identity
  - lane centerlines
  - traffic-control and intersection attributes
- Notes: Version 1.1 is selected over deprecated 1.0. Default download is validation plus HD maps; --sample selects the five-scenario official sample and --full adds train/test. No checksum is published; archive byte length is verified. Sensor/stereo collections are not selected because the project does not process LiDAR or imagery.
