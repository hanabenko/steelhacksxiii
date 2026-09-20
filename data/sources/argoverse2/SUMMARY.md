# Argoverse 2 Motion Forecasting Dataset — summary

Generated from `data/manifests/argoverse2.json` on 2026-09-20.

- Status: `downloadable`
- Recommended for hackathon: no
- Download storage: 57.44 GiB complete release; 0 bytes by default
- Extracted storage: At least 57.44 GiB; reserve 115 GiB for archives plus extracted files.
- Geographic coverage: Austin, Detroit, Miami, Pittsburgh, Palo Alto, and Washington, DC; individual archive membership must be inspected after download to identify Pittsburgh scenarios.
- Pittsburgh coverage: Yes, but city labels should be verified from downloaded scenario metadata before calibration.
- Summary: 250,000 11-second, 10 Hz multi-agent motion scenarios with 2D centroids, headings, object classes, and local HD maps. It is valuable future research data but too large for the hackathon default.
- Useful SUMO-calibration fields:
  - track trajectories
  - timestamps
  - headings
  - object type
  - local lane/crosswalk geometry
  - agent category
- Notes: Official direct archives are used only with --full. No checksum is published; archive byte length is verified. The much larger AV2 sensor/lidar/map-change collections are intentionally out of scope because this pipeline does not process LiDAR.
