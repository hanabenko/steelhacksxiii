"""Public game-facing interface for Interlock's SUMO integration."""

from typing import Any


def simulate_scenario(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from simulation.api import simulate_scenario as implementation

    return implementation(*args, **kwargs)


def compare_scenario_configs(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from simulation.api import compare_scenario_configs as implementation

    return implementation(*args, **kwargs)


def get_baseline_state(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from simulation.baseline import get_baseline_state as implementation

    return implementation(*args, **kwargs)


def get_scenario_state(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from simulation.baseline import get_scenario_state as implementation

    return implementation(*args, **kwargs)


def simulate_frontend_scenario(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from simulation.frontend_contract import simulate_frontend_scenario as implementation

    return implementation(*args, **kwargs)


__all__ = [
    "compare_scenario_configs",
    "get_baseline_state",
    "get_scenario_state",
    "simulate_frontend_scenario",
    "simulate_scenario",
]
