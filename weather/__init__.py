"""Weather conditions for Interlock: data, profiles, and SUMO physics.

Everything weather-related lives in this folder — the fetcher, the derived
datasets, the behaviour profiles, and the tests. The simulation reaches it
through the three names re-exported here.
"""

from weather.model import (
    DEFAULT_WEATHER,
    WEATHER_PROFILES,
    MonthlyExposure,
    WeatherProfile,
    apply_to_pedestrian_rate,
    apply_to_vtype,
    get_profile,
    monthly_exposure,
    sample_condition,
    stopping_distance_m,
)

__all__ = [
    "DEFAULT_WEATHER",
    "WEATHER_PROFILES",
    "MonthlyExposure",
    "WeatherProfile",
    "apply_to_pedestrian_rate",
    "apply_to_vtype",
    "get_profile",
    "monthly_exposure",
    "sample_condition",
    "stopping_distance_m",
]
