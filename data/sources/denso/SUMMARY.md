# DENSO Pittsburgh Innovation Lab / City of Pittsburgh Perception Data Set — summary

Generated from `data/manifests/denso.json` on 2026-09-20.

- Status: `restricted`
- Recommended for hackathon: no — access is manual and terms are not public
- Download storage: Not published
- Extracted storage: Not published
- Geographic coverage: 17 diverse routes in the Pittsburgh area; the official page describes it as Downtown Pittsburgh data.
- Pittsburgh coverage: Yes; primary Pittsburgh source once access and license are confirmed.
- Summary: 360,000 synchronized 10 Hz frames; 36,000 frames (10%) have 3D bounding boxes for vehicles, pedestrians, and cyclists. Sensor descriptions include six cameras, seven SPAD LiDARs, GPS, and CAN/vehicle dynamics. No data is downloaded automatically.
- Useful SUMO-calibration fields:
  - GPS/localization
  - vehicle dynamics
  - 10 Hz temporal alignment
  - 3D boxes for vehicles/pedestrians/cyclists
  - route context
- Notes: This pipeline deliberately does not scrape or infer a download URL. After receiving a licensed archive, place it in downloads/ and add its checksum locally or update this manifest through review.
