"""Download OpenStreetMap data and build a small SUMO network."""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import Request, urlopen

from sumolib.net import readNet

REPO_ROOT = Path(__file__).resolve().parents[1]
NETWORK_ROOT = REPO_ROOT / "simulation" / "networks"
USER_AGENT = "Interlock/0.1 (SteelHacks XIII student project)"


@dataclass(frozen=True)
class IntersectionNetwork:
    intersection_id: str
    longitude: float
    latitude: float
    street_names: tuple[str, ...]
    radius_m: float = 500.0
    target_junction_id: str | None = None
    traffic_light_id: str | None = None
    candidate_id: str | None = None
    calibration_fallback_intersection_id: str | None = None

    @property
    def directory(self) -> Path:
        return NETWORK_ROOT / self.intersection_id

    @property
    def osm_path(self) -> Path:
        return self.directory / "source.osm.xml"

    @property
    def net_path(self) -> Path:
        return self.directory / "network.net.xml"

    @property
    def metadata_path(self) -> Path:
        return self.directory / "network.json"


@dataclass(frozen=True)
class IntersectionPlan:
    target_node_id: str
    traffic_light_id: str | None
    vehicle_routes: tuple[tuple[str, ...], ...]
    pedestrian_routes: tuple[tuple[str, str], ...]


NETWORKS = {
    "fifth-meyran": IntersectionNetwork(
        intersection_id="fifth-meyran",
        longitude=-79.9592766237412,
        latitude=40.44116260191021,
        street_names=("Fifth Avenue", "Meyran Avenue"),
        target_junction_id="cluster_104580895_8099223724",
        candidate_id="signal_1977783821",
    ),
    # This checked-in extract is the same OSM campus extract used by the frontend.
    # It intentionally remains a separate SUMO network, not a Three.js coordinate system.
    "pitt-forbes-bigelow": IntersectionNetwork(
        intersection_id="pitt-forbes-bigelow",
        longitude=-79.9535474,
        latitude=40.4431909,
        street_names=("Forbes Avenue", "Bigelow Boulevard"),
        radius_m=500.0,
        target_junction_id="cluster_105013345_6715675240_6715675241_6715675242_#1more",
        traffic_light_id="cluster_105013345_6715675240_6715675241_6715675242_#1more",
        candidate_id="frontend-osm-node-105013345",
        # No complete local traffic-count calibration has been imported for this
        # frontend target yet. Reuse is explicit in run assumptions, never implied
        # to be a Forbes/Bigelow observation.
        calibration_fallback_intersection_id="fifth-meyran",
    ),
}


def sumo_binary(name: str) -> str:
    executable = shutil.which(name)
    if executable:
        return executable
    try:
        from sumolib import checkBinary

        return checkBinary(name)
    except (ImportError, FileNotFoundError):
        raise RuntimeError(
            f"SUMO executable '{name}' was not found. Install eclipse-sumo with `uv sync` "
            "or install SUMO system-wide."
        ) from None


def bounding_box(spec: IntersectionNetwork) -> tuple[float, float, float, float]:
    latitude_delta = spec.radius_m / 111_320.0
    longitude_delta = spec.radius_m / (
        111_320.0 * math.cos(math.radians(spec.latitude))
    )
    return (
        spec.longitude - longitude_delta,
        spec.latitude - latitude_delta,
        spec.longitude + longitude_delta,
        spec.latitude + latitude_delta,
    )


def download_osm(spec: IntersectionNetwork, force: bool = False) -> None:
    if spec.osm_path.exists() and not force:
        return
    spec.directory.mkdir(parents=True, exist_ok=True)
    bbox = bounding_box(spec)
    url = "https://api.openstreetmap.org/api/0.6/map?bbox=" + ",".join(
        f"{coordinate:.7f}" for coordinate in bbox
    )
    request = Request(url, headers={"User-Agent": USER_AGENT})
    temporary_path: Path | None = None
    try:
        with (
            urlopen(request, timeout=180) as response,
            tempfile.NamedTemporaryFile(
                dir=spec.directory,
                prefix=".source.",
                suffix=".osm.xml.part",
                delete=False,
            ) as temporary,
        ):
            temporary_path = Path(temporary.name)
            shutil.copyfileobj(response, temporary)
        temporary_path.replace(spec.osm_path)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()
    spec.metadata_path.write_text(
        json.dumps(
            {
                "intersection_id": spec.intersection_id,
                "center": {"longitude": spec.longitude, "latitude": spec.latitude},
                "radius_m": spec.radius_m,
                "bbox_wgs84": bbox,
                "source_url": url,
                "retrieved_at": datetime.now(UTC).isoformat(),
                "license": "Open Data Commons Open Database License (ODbL)",
                "attribution": "© OpenStreetMap contributors",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def build_network(spec: IntersectionNetwork, force: bool = False) -> Path:
    download_osm(spec, force=force)
    if spec.net_path.exists() and not force:
        return spec.net_path
    command = [
        sumo_binary("netconvert"),
        "--osm-files",
        str(spec.osm_path),
        "--output-file",
        str(spec.net_path),
        "--geometry.remove",
        "--roundabouts.guess",
        "--ramps.guess",
        "--junctions.join",
        "--tls.guess-signals",
        "--tls.discard-simple",
        "--tls.join",
        "--tls.default-type",
        "static",
        "--keep-edges.by-vclass",
        "passenger,pedestrian",
        "--keep-edges.components",
        "1",
        "--sidewalks.guess",
        "true",
        "--crossings.guess",
        "true",
        "--output.street-names",
        "true",
    ]
    subprocess.run(command, check=True)
    return spec.net_path


def ensure_network(intersection_id: str, force: bool = False) -> IntersectionNetwork:
    try:
        spec = NETWORKS[intersection_id]
    except KeyError:
        supported = ", ".join(sorted(NETWORKS))
        raise ValueError(f"Unsupported intersection '{intersection_id}'. Choose: {supported}") from None
    build_network(spec, force=force)
    return spec


def target_network_plan(spec: IntersectionNetwork) -> IntersectionPlan:
    net = readNet(str(spec.net_path), withInternal=True)
    target_x, target_y = net.convertLonLat2XY(spec.longitude, spec.latitude)
    nodes = [node for node in net.getNodes() if not node.getID().startswith(":")]
    required_names = {name.casefold() for name in spec.street_names}
    named_nodes = []
    for node in nodes:
        edge_names = {
            edge.getName().casefold()
            for edge in (*node.getIncoming(), *node.getOutgoing())
            if not edge.isSpecial() and edge.getName()
        }
        if required_names.issubset(edge_names):
            named_nodes.append(node)
    target = next(
        (node for node in nodes if node.getID() == spec.target_junction_id),
        None,
    )
    if target is None:
        target = min(
            named_nodes or nodes,
            key=lambda node: math.dist(node.getCoord(), (target_x, target_y)),
        )
    routes: list[tuple[str, ...]] = []
    traffic_light_ids: set[str] = set()
    for incoming in target.getIncoming():
        if incoming.isSpecial() or not any(
            lane.allows("passenger") for lane in incoming.getLanes()
        ):
            continue
        for outgoing in target.getOutgoing():
            if (
                outgoing.isSpecial()
                or not any(lane.allows("passenger") for lane in outgoing.getLanes())
                or incoming.getFromNode() == outgoing.getToNode()
            ):
                continue
            connections = incoming.getConnections(outgoing)
            if connections:
                routes.append((incoming.getID(), outgoing.getID()))
                traffic_light_ids.update(
                    connection.getTLSID()
                    for connection in connections
                    if connection.getTLSID()
                )
    if not routes:
        raise RuntimeError(f"No drivable routes cross SUMO junction {target.getID()}")

    adjacent_pedestrian_edges = {
        edge.getID(): edge
        for edge in (*target.getIncoming(), *target.getOutgoing())
        if not edge.isSpecial()
        and any(lane.allows("pedestrian") for lane in edge.getLanes())
    }
    routes_by_crossing: dict[str, tuple[float, tuple[str, str]]] = {}
    for origin in adjacent_pedestrian_edges.values():
        for destination in adjacent_pedestrian_edges.values():
            if origin == destination:
                continue
            path, cost = net.getOptimalPath(
                origin,
                destination,
                vClass="pedestrian",
                withInternal=True,
            )
            if not path or cost is None:
                continue
            target_crossings = [
                edge.getID()
                for edge in path
                if edge.getFunction() == "crossing" and target.getID() in edge.getID()
            ]
            for crossing in target_crossings:
                candidate = (float(cost), (origin.getID(), destination.getID()))
                if crossing not in routes_by_crossing or candidate < routes_by_crossing[crossing]:
                    routes_by_crossing[crossing] = candidate

    return IntersectionPlan(
        target_node_id=target.getID(),
        traffic_light_id=(
            spec.traffic_light_id
            if spec.traffic_light_id in traffic_light_ids
            else min(traffic_light_ids) if traffic_light_ids else None
        ),
        vehicle_routes=tuple(sorted(set(routes))),
        pedestrian_routes=tuple(
            sorted({route for _, route in routes_by_crossing.values()})
        ),
    )


def target_node_and_routes(spec: IntersectionNetwork) -> tuple[str, list[list[str]]]:
    """Backward-compatible vehicle route view used by earlier callers."""
    plan = target_network_plan(spec)
    return plan.target_node_id, [list(route) for route in plan.vehicle_routes]
