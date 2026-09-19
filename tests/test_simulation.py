from __future__ import annotations

import xml.etree.ElementTree as ET

import pytest

from simulation.network import NETWORKS, bounding_box
from simulation.run import Calibration, percentile, target_node_and_routes, write_routes


def test_fifth_meyran_network_targets_named_intersection() -> None:
    spec = NETWORKS["fifth-meyran"]
    node_id, routes = target_node_and_routes(
        spec.net_path,
        spec.longitude,
        spec.latitude,
        spec.street_names,
    )

    assert node_id == "104580895"
    assert len(routes) == 3
    assert all(len(route) == 2 for route in routes)


def test_route_demand_uses_observed_adt(tmp_path) -> None:
    calibration = Calibration(
        source_record_id="428229895",
        average_daily_traffic=382,
        median_speed_mph=16,
        p85_speed_mph=20,
        speed_limit_mph=25,
    )
    destination = tmp_path / "baseline.rou.xml"

    vehicle_count = write_routes(
        destination,
        [["in", "out"]],
        calibration,
        duration_s=600,
        seed=42,
    )

    assert vehicle_count == 3
    root = ET.parse(destination).getroot()
    assert len(root.findall("vehicle")) == 3
    vehicle_type = root.find("vType")
    assert vehicle_type is not None
    assert vehicle_type.attrib["speedFactor"] == "0.640"


def test_percentile_interpolates_and_handles_empty_input() -> None:
    assert percentile([], 0.95) is None
    assert percentile([1.0, 2.0, 3.0], 0.5) == 2.0
    assert percentile([0.0, 10.0], 0.95) == pytest.approx(9.5)


def test_osm_bbox_contains_intersection_center() -> None:
    spec = NETWORKS["fifth-meyran"]
    west, south, east, north = bounding_box(spec)

    assert west < spec.longitude < east
    assert south < spec.latitude < north
