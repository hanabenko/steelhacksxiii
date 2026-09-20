# Argoverse 1.1 — selected Motion Forecasting release

Official source: <https://www.argoverse.org/av1.html>. Version 1.1 is selected instead of deprecated 1.0. It contains 324,557 five-second, 10 Hz scenarios with tracked-object centroids and Pittsburgh/Miami HD maps.

Pittsburgh is explicitly documented: Downtown, Strip District, and Lower Lawrenceville, with 86 linear km of lane coverage. This is the smaller, useful legacy source for Pittsburgh trajectory behavior, lane paths, intersections, and traffic-control context. It does not by itself establish conditions at Fifth/Meyran or Forbes/Bigelow.

License: CC BY-NC-SA 4.0. The default calibration bundle downloads validation plus maps (about 645 MiB; budget about 1.5 GiB extracted), rather than the complete release. Use `--sample` for five official sample scenarios or `--full` for train/test as well. See `../../manifests/argoverse1.json`.
