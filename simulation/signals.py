"""SUMO traffic-light adaptation behind game-friendly interventions."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import traci

from simulation.interventions import Scenario, SignalTimingChange


def principal_green_phase_indices(phases: Sequence[Any]) -> tuple[int, int]:
    """Find the two longest vehicle-green phases without exposing SUMO indices."""
    candidates = [
        (float(phase.duration), index)
        for index, phase in enumerate(phases)
        if "G" in phase.state
    ]
    if len(candidates) < 2:
        raise RuntimeError("The target signal does not expose two vehicle-green phases")
    selected = sorted(index for _, index in sorted(candidates, reverse=True)[:2])
    return selected[0], selected[1]


def phase_duration_overrides(
    phases: Sequence[Any], intervention: SignalTimingChange
) -> dict[int, float]:
    main_index, side_index = principal_green_phase_indices(phases)
    return {
        main_index: intervention.main_green_s,
        side_index: intervention.side_green_s,
    }


def apply_signal_interventions(scenario: Scenario, traffic_light_id: str | None) -> None:
    changes = [
        item for item in scenario.interventions if isinstance(item, SignalTimingChange)
    ]
    if not changes:
        return
    if not traffic_light_id:
        raise RuntimeError("The target intersection has no usable traffic-light program")
    logics = list(traci.trafficlight.getAllProgramLogics(traffic_light_id))
    if not logics:
        raise RuntimeError(f"Traffic light {traffic_light_id} has no programs")
    active_program = traci.trafficlight.getProgram(traffic_light_id)
    logic = next((item for item in logics if item.programID == active_program), logics[0])
    for index, duration in phase_duration_overrides(logic.phases, changes[0]).items():
        logic.phases[index].duration = duration
    traci.trafficlight.setProgramLogic(traffic_light_id, logic)
