# Argoverse 2 — selected Motion Forecasting release

Official source: <https://www.argoverse.org/av2.html>. The pipeline selects the public Motion Forecasting archives, not the 1 TB Sensor, 5 TB LiDAR, or 1 TB Map Change releases: Interlock needs trajectories and local HD-map context now and does not process LiDAR or imagery.

It contains 250,000 11-second scenarios at 10 Hz from six U.S. cities, including Pittsburgh. Fields useful to future SUMO calibration include multi-agent tracks, headings, timestamps, object classes, lane-level geometry, and crosswalks. The official documentation does not promise every archive item is Pittsburgh; filter by downloaded scenario metadata before analysis.

License: CC BY-NC-SA 4.0. No account is required. Archives total about 57.44 GiB before extraction and are **not** a hackathon download. No official mini/subset AV2 release was found, so use `python data/scripts/download.py --dataset argoverse2 --full` only for later research.
