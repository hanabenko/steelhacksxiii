"""Seeded, observation-calibrated SUMO demand generation."""

from __future__ import annotations

import random
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

from simulation.interventions import Scenario
from simulation.models import Calibration

MPH_TO_MPS = 0.44704


@dataclass(frozen=True)
class DemandPlan:
    vehicle_count: int
    pedestrian_count: int
    arrival_model: str
    average_hourly_traffic: float
    assumed_pedestrians_per_hour: float
    driver_sigma: float
    speed_factor_mean: float
    speed_factor_deviation: float
    demand_source: str = "traffic_observation"

    def to_dict(self) -> dict[str, float | int | str]:
        return self.__dict__.copy()


@dataclass(frozen=True)
class PedestrianDemandConfig:
    """Explicit, non-observed pedestrian-demand assumption."""

    pedestrians_per_hour: float = 60.0
    mean_walking_speed_mps: float = 1.4
    walking_speed_stddev_mps: float = 0.15

    def __post_init__(self) -> None:
        if self.pedestrians_per_hour < 0:
            raise ValueError("Pedestrian demand cannot be negative")
        if self.mean_walking_speed_mps <= 0 or self.walking_speed_stddev_mps < 0:
            raise ValueError("Pedestrian walking-speed parameters are invalid")

    def to_dict(self) -> dict[str, float]:
        return self.__dict__.copy()


def _poisson_departures(
    randomizer: random.Random,
    hourly_rate: float,
    last_departure: float,
    ensure_one: bool,
) -> list[float]:
    departures = []
    rate_per_second = hourly_rate / 3600
    if rate_per_second > 0 and last_departure > 0:
        departure = randomizer.expovariate(rate_per_second)
        while departure <= last_departure:
            departures.append(departure)
            departure += randomizer.expovariate(rate_per_second)
    if ensure_one and hourly_rate > 0 and not departures:
        departures.append(min(last_departure, max(0.0, last_departure * 0.1)))
    return departures


def write_routes(
    destination: Path,
    routes: list[list[str]],
    pedestrian_routes: list[tuple[str, str]] | tuple[tuple[str, str], ...],
    calibration: Calibration,
    scenario: Scenario,
    duration_s: int,
    seed: int,
    pedestrian_config: PedestrianDemandConfig | None = None,
) -> DemandPlan:
    """Write matched Poisson arrivals and observed-speed driver parameters."""
    randomizer = random.Random(seed)
    effective_limit = scenario.effective_speed_limit_mph(calibration)
    # Preserve the observed Fifth/Meyran speed-to-limit ratio when a scenario
    # changes the posted limit. SUMO applies speedFactor to the network edge's
    # original limit, while maxSpeed provides a hard cap for the intervention.
    limit_ratio = effective_limit / calibration.speed_limit_mph
    median_factor = (
        calibration.median_speed_mph / calibration.speed_limit_mph * limit_ratio
    )
    speed_deviation = max(
        0.05,
        (calibration.p85_speed_mph - calibration.median_speed_mph)
        / calibration.speed_limit_mph
        * limit_ratio,
    )
    driver_sigma = 0.5  # SUMO's default driver-imperfection value.
    root = ET.Element("routes")
    ET.SubElement(
        root,
        "vType",
        {
            "id": "calibrated_passenger",
            "vClass": "passenger",
            "accel": "2.6",
            "decel": "4.5",
            "sigma": f"{driver_sigma:.2f}",
            "length": "5.0",
            "minGap": "2.5",
            "maxSpeed": f"{effective_limit * MPH_TO_MPS:.3f}",
            "speedFactor": f"{median_factor:.3f}",
            "speedDev": f"{speed_deviation:.3f}",
        },
    )
    for index, edges in enumerate(routes):
        ET.SubElement(root, "route", {"id": f"crossing_{index}", "edges": " ".join(edges)})

    last_departure = max(0.0, duration_s - 120.0)
    hourly_traffic = (
        scenario.vehicle_demand_vehicles_per_hour
        if scenario.vehicle_demand_vehicles_per_hour is not None
        else calibration.average_hourly_traffic
    )
    departures = _poisson_departures(
        randomizer,
        hourly_traffic,
        last_departure,
        ensure_one=True,
    )

    vehicle_specs = [
        (departure, index, randomizer.randrange(len(routes)))
        for index, departure in enumerate(departures)
    ]

    pedestrian_config = pedestrian_config or PedestrianDemandConfig()
    pedestrian_randomizer = random.Random(seed ^ 0x5EED5EED)
    pedestrian_departures = _poisson_departures(
        pedestrian_randomizer,
        pedestrian_config.pedestrians_per_hour,
        max(0.0, duration_s - 60.0),
        ensure_one=bool(pedestrian_routes),
    )
    if not pedestrian_routes:
        pedestrian_departures = []
    pedestrian_specs = []
    for index, departure in enumerate(pedestrian_departures):
        origin, destination_edge = pedestrian_randomizer.choice(pedestrian_routes)
        speed = min(
            2.0,
            max(
                0.8,
                pedestrian_randomizer.gauss(
                    pedestrian_config.mean_walking_speed_mps,
                    pedestrian_config.walking_speed_stddev_mps,
                ),
            ),
        )
        pedestrian_specs.append((departure, index, origin, destination_edge, speed))

    demand_entries = [
        (departure, "vehicle", (index, route_index))
        for departure, index, route_index in vehicle_specs
    ] + [
        (departure, "pedestrian", (index, origin, destination_edge, speed))
        for departure, index, origin, destination_edge, speed in pedestrian_specs
    ]
    for departure, actor_type, values in sorted(demand_entries):
        if actor_type == "vehicle":
            index, route_index = values
            ET.SubElement(
                root,
                "vehicle",
                {
                    "id": f"vehicle_{index:04d}",
                    "type": "calibrated_passenger",
                    "route": f"crossing_{route_index}",
                    "depart": f"{departure:.1f}",
                    "departLane": "best",
                    "departSpeed": "max",
                },
            )
            continue
        index, origin, destination_edge, speed = values
        person = ET.SubElement(
            root,
            "person",
            {"id": f"pedestrian_{index:04d}", "depart": f"{departure:.1f}"},
        )
        ET.SubElement(
            person,
            "walk",
            {
                "from": origin,
                "to": destination_edge,
                "speed": f"{speed:.3f}",
            },
        )
    ET.indent(root)
    ET.ElementTree(root).write(destination, encoding="utf-8", xml_declaration=True)
    return DemandPlan(
        vehicle_count=len(departures),
        pedestrian_count=len(pedestrian_departures),
        arrival_model="poisson_exponential_interarrival",
        average_hourly_traffic=hourly_traffic,
        assumed_pedestrians_per_hour=pedestrian_config.pedestrians_per_hour,
        driver_sigma=driver_sigma,
        speed_factor_mean=median_factor,
        speed_factor_deviation=speed_deviation,
        demand_source=(
            "scenario_override" if scenario.vehicle_demand_vehicles_per_hour is not None else "traffic_observation"
        ),
    )
