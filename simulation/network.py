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


NETWORKS = {
    "fifth-meyran": IntersectionNetwork(
        intersection_id="fifth-meyran",
        longitude=-79.9592766237412,
        latitude=40.44116260191021,
        street_names=("Fifth Avenue", "Meyran Avenue"),
    )
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
        "passenger",
        "--keep-edges.components",
        "1",
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
