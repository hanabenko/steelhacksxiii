"""Public game-facing interface for Interlock's SUMO integration."""

from typing import Any


def simulate_scenario(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from simulation.api import simulate_scenario as implementation

    return implementation(*args, **kwargs)


def compare_scenario_configs(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from simulation.api import compare_scenario_configs as implementation

    return implementation(*args, **kwargs)


__all__ = ["compare_scenario_configs", "simulate_scenario"]
