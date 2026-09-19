"""Closed-set intent routing for the Interlock map.

The voice interface is deliberately NOT a general assistant. A question is
matched against a fixed list of map- and game-scoped intents; anything else
gets a short redirect naming what the voice can actually do. Every answer is
assembled from the caller-supplied `SceneContext`, so the voice can only ever
say things the map already knows. There is no language model in this path,
which makes the replies deterministic and unit-testable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum

from .context import SceneContext
from . import speech


class Intent(str, Enum):
    ROUTE_SAFETY = "route_safety"
    STREET_NAME = "street_name"
    INTERSECTION_SUMMARY = "intersection_summary"
    SIMULATION_SUMMARY = "simulation_summary"
    WARNINGS = "warnings"
    CRASH_HISTORY = "crash_history"
    BUDGET = "budget"
    PLACEMENTS = "placements"
    OBJECTIVES = "objectives"
    HELP = "help"
    OUT_OF_SCOPE = "out_of_scope"


@dataclass(frozen=True)
class Answer:
    intent: Intent
    text: str
    grounded: bool = True
    missing: tuple[str, ...] = field(default_factory=tuple)


# Ordered most specific first; the first pattern that matches wins.
_RULES: list[tuple[Intent, re.Pattern[str]]] = [
    (
        Intent.ROUTE_SAFETY,
        re.compile(
            r"\b(how safe|is it safe|safe (?:to |for )?(?:walk|bike|cycle|cross)"
            r"|safety of (?:the |my )?(?:route|path|walk|way)"
            r"|(?:route|path|walk|way) to (?:my |the )?(?:school|work|home|campus)"
            r"|walk to school|bike to school|safest (?:route|way|path))\b",
            re.IGNORECASE,
        ),
    ),
    (
        Intent.CRASH_HISTORY,
        re.compile(
            r"\b(crash|crashes|collision|collisions|accident|accidents|injur\w*"
            r"|high injury network|been hit|pedestrian struck)\b",
            re.IGNORECASE,
        ),
    ),
    (
        Intent.STREET_NAME,
        re.compile(
            r"\b(what (?:street|road|avenue|ave|boulevard|blvd) (?:is|am)"
            r"|which street|name of (?:this |the )?(?:street|road)"
            r"|where am i|what'?s this street|what street)\b",
            re.IGNORECASE,
        ),
    ),
    (
        Intent.SIMULATION_SUMMARY,
        re.compile(
            r"\b(simulat\w*|how did (?:my|the) (?:design|build)|results?|score"
            r"|before and after|did (?:it|my design) (?:work|help|improve)"
            r"|throughput|delay|speed|how'?d i do)\b",
            re.IGNORECASE,
        ),
    ),
    (
        Intent.BUDGET,
        re.compile(
            r"\b(budget|spend|spent|spending|cost|costs|afford|money|dollars"
            r"|how much (?:do i have|is left|have i))\b",
            re.IGNORECASE,
        ),
    ),
    (
        Intent.PLACEMENTS,
        re.compile(
            r"\b(what have i (?:built|placed|added)|my (?:upgrades?|placements?|design|build)"
            r"|what (?:did|have) i (?:change|changed|add|added)|list (?:my )?upgrades?"
            r"|what'?s (?:been )?(?:built|placed))\b",
            re.IGNORECASE,
        ),
    ),
    (
        Intent.OBJECTIVES,
        re.compile(
            r"\b(objectives?|goals?|what (?:am i|should i) (?:trying to|do)"
            r"|how do i win|targets?|mission)\b",
            re.IGNORECASE,
        ),
    ),
    (
        Intent.WARNINGS,
        re.compile(
            r"\b(warn\w*|danger\w*|risk\w*|hazard\w*|problem|problems|issues?"
            r"|conflicts?|near miss|near misses|what'?s wrong)\b",
            re.IGNORECASE,
        ),
    ),
    (
        Intent.INTERSECTION_SUMMARY,
        re.compile(
            r"\b(what am i looking at"
            r"|what(?:'?s| is) (?:this|the) (?:place|spot|scene|corner|intersection)"
            r"|this intersection|where is this"
            r"|tell me about (?:this|the) (?:place|intersection|corner)"
            r"|describe (?:this|the) (?:scene|intersection))\b",
            re.IGNORECASE,
        ),
    ),
    (
        Intent.HELP,
        re.compile(
            r"\b(help|what can you (?:do|say|tell)|commands?|options?"
            r"|how (?:do i|does this) (?:use|work))\b",
            re.IGNORECASE,
        ),
    ),
]

_SCOPE_REDIRECT = (
    "I only answer questions about this intersection and your design. "
    "Try asking how safe the route is, what street this is, "
    "what your simulation showed, or how much budget is left."
)


def classify(question: str) -> Intent:
    """Map a question to exactly one intent, defaulting to out of scope."""
    text = (question or "").strip()
    if not text:
        return Intent.OUT_OF_SCOPE
    for intent, pattern in _RULES:
        if pattern.search(text):
            return intent
    return Intent.OUT_OF_SCOPE


def answer(question: str, context: SceneContext) -> Answer:
    """Produce a grounded spoken reply for a question about the scene."""
    intent = classify(question)
    return _HANDLERS[intent](context)


# --- Handlers --------------------------------------------------------------
# Each returns text only from `context`. When the needed field is absent the
# handler says so and records the field name in `missing`, so the frontend can
# surface a "load this first" hint instead of the voice inventing an answer.


def _place(context: SceneContext) -> str:
    return context.intersection_name or "this intersection"


def _route_safety(context: SceneContext) -> Answer:
    route = context.route
    if route is None or not route.legs:
        return Answer(
            Intent.ROUTE_SAFETY,
            "No route is selected yet. Draw or pick a route on the map and I'll walk "
            "you through it street by street.",
            grounded=False,
            missing=("route",),
        )

    destination = route.destination or route.name or "your destination"
    parts: list[str] = [f"Here is the route to {destination}."]
    flagged: list[str] = []

    for leg in route.legs:
        details: list[str] = []
        if leg.speed_limit_mph is not None:
            details.append(f"posted at {speech.mph(leg.speed_limit_mph)}")
        if leg.has_crosswalk is True:
            details.append("with a marked crosswalk")
        elif leg.has_crosswalk is False:
            details.append("with no marked crosswalk")
            flagged.append(leg.street)
        if leg.has_bike_lane is True:
            details.append("a bike lane")
        if leg.crash_count:
            details.append(speech.count(leg.crash_count, "recorded crash"))
            if leg.crash_count >= 10 and leg.street not in flagged:
                flagged.append(leg.street)

        span = ""
        if leg.from_street and leg.to_street:
            span = f" from {leg.from_street} to {leg.to_street}"
        suffix = f", {speech.join(details)}" if details else ""
        parts.append(f"{leg.street}{span}{suffix}.")

    if flagged:
        parts.append(f"Take extra care on {speech.join(flagged)}.")
    else:
        parts.append("Nothing on this route is flagged.")

    if context.data_note:
        parts.append(speech.speakable(context.data_note))

    return Answer(Intent.ROUTE_SAFETY, " ".join(parts))


def _street_name(context: SceneContext) -> Answer:
    if context.focused_street:
        zone = f", on the {context.focused_zone} approach" if context.focused_zone else ""
        return Answer(
            Intent.STREET_NAME, f"You're looking at {context.focused_street}{zone}."
        )
    if context.streets:
        return Answer(
            Intent.STREET_NAME,
            f"This is {speech.join(context.streets)}. "
            "Point at one of the approaches and I'll name just that street.",
        )
    return Answer(
        Intent.STREET_NAME,
        "I don't have street names loaded for this scene yet.",
        grounded=False,
        missing=("streets",),
    )


def _intersection_summary(context: SceneContext) -> Answer:
    if not context.intersection_name and not context.streets:
        return Answer(
            Intent.INTERSECTION_SUMMARY,
            "No intersection is loaded yet.",
            grounded=False,
            missing=("intersection_name",),
        )
    parts = [f"This is {_place(context)}."]
    if context.streets:
        parts.append(f"It joins {speech.join(context.streets)}.")
    if context.speed_limit_mph is not None:
        parts.append(f"The posted limit is {speech.mph(context.speed_limit_mph)}.")
    history = context.crash_history
    if history and history.total is not None:
        parts.append(f"{speech.count(history.total, 'crash')} are on record here.")
    if context.placements:
        parts.append(f"You've placed {speech.count(len(context.placements), 'upgrade')}.")
    return Answer(Intent.INTERSECTION_SUMMARY, " ".join(parts))


def _simulation_summary(context: SceneContext) -> Answer:
    results = context.results
    if results is None or results.before is None or results.after is None:
        return Answer(
            Intent.SIMULATION_SUMMARY,
            "You haven't run a simulation yet. Place an upgrade, then run the "
            "simulation and I'll read the results back.",
            grounded=False,
            missing=("results",),
        )

    parts: list[str] = []
    if results.stale:
        parts.append("Heads up, these results are from before your latest change.")

    before, after = results.before, results.after

    if before.risk and after.risk:
        direction = "down" if after.risk.mean <= before.risk.mean else "up"
        parts.append(
            f"The conflict proxy went {direction} from {speech.number(before.risk.mean, 1)} "
            f"to {speech.number(after.risk.mean, 1)} per thousand vehicles."
        )
    if before.speed and after.speed:
        parts.append(
            f"Average speed moved from {speech.mph(before.speed.mean, 1)} "
            f"to {speech.mph(after.speed.mean, 1)}."
        )
    if before.delay and after.delay:
        parts.append(
            f"Delay went from {speech.seconds(before.delay.mean, 1)} "
            f"to {speech.seconds(after.delay.mean, 1)} per vehicle."
        )
    if before.throughput and after.throughput:
        parts.append(
            f"Throughput is {speech.number(after.throughput.mean)} vehicles per hour, "
            f"against {speech.number(before.throughput.mean)} before."
        )
    if before.access and after.access:
        parts.append(
            f"Pedestrian access scored {speech.number(after.access.mean)} out of 100, "
            f"up from {speech.number(before.access.mean)}."
        )
    if results.score is not None:
        parts.append(f"Your overall score is {speech.number(results.score)} out of 100.")
    if results.runs:
        engine = results.engine or "the simulation engine"
        parts.append(f"That's {speech.count(results.runs, 'trial')} on {engine}.")

    if not parts:
        return Answer(
            Intent.SIMULATION_SUMMARY,
            "The simulation returned no metrics I can read back.",
            grounded=False,
            missing=("results",),
        )
    return Answer(Intent.SIMULATION_SUMMARY, " ".join(parts))


def _warnings(context: SceneContext) -> Answer:
    if not context.warnings:
        return Answer(Intent.WARNINGS, "No warnings are active on this design right now.")
    spoken = [speech.speakable(warning).rstrip(".") for warning in context.warnings]
    if len(spoken) == 1:
        return Answer(Intent.WARNINGS, f"One warning. {spoken[0]}.")
    body = " ".join(f"{index}. {item}." for index, item in enumerate(spoken, start=1))
    return Answer(Intent.WARNINGS, f"{speech.count(len(spoken), 'warning')}. {body}")


def _crash_history(context: SceneContext) -> Answer:
    history = context.crash_history
    if history is None or history.total is None:
        return Answer(
            Intent.CRASH_HISTORY,
            "I don't have crash history loaded for this intersection.",
            grounded=False,
            missing=("crash_history",),
        )

    scope = f" within {speech.number(history.radius_meters)} meters" if history.radius_meters else ""
    window = f" over {history.period}" if history.period else ""
    parts = [f"{speech.count(history.total, 'crash')} are on record{scope}{window}."]

    breakdown: list[str] = []
    if history.injury is not None:
        breakdown.append(f"{speech.number(history.injury)} involved injuries")
    if history.severe is not None:
        breakdown.append(f"{speech.number(history.severe)} were severe")
    if history.vulnerable_road_user is not None:
        breakdown.append(
            f"{speech.number(history.vulnerable_road_user)} involved people walking or biking"
        )
    if breakdown:
        parts.append(f"Of those, {speech.join(breakdown)}.")
    if history.high_injury_network:
        parts.append("This corner sits on the city's High Injury Network.")
    if context.data_note:
        parts.append(speech.speakable(context.data_note))
    return Answer(Intent.CRASH_HISTORY, " ".join(parts))


def _budget(context: SceneContext) -> Answer:
    budget = context.budget
    if budget is None or budget.total is None or budget.spent is None:
        return Answer(
            Intent.BUDGET,
            "No budget is set for this scenario yet.",
            grounded=False,
            missing=("budget",),
        )
    remaining = budget.remaining or 0.0
    parts = [
        f"You've spent {speech.money(budget.spent)} of {speech.money(budget.total)}, "
        f"leaving {speech.money(remaining)}."
    ]
    if budget.total:
        parts.append(f"That's {speech.percent(100 * budget.spent / budget.total)} of the budget.")
    if remaining <= 0:
        parts.append("You're out of money. Remove an upgrade to free some up.")
    return Answer(Intent.BUDGET, " ".join(parts))


def _placements(context: SceneContext) -> Answer:
    if not context.placements:
        return Answer(
            Intent.PLACEMENTS,
            "You haven't placed anything yet. Drag an upgrade onto one of the approaches.",
        )
    described: list[str] = []
    for placement in context.placements:
        name = placement.label or placement.type.replace("_", " ").replace("-", " ")
        where = f" on the {placement.zone} approach" if placement.zone else ""
        price = f" for {speech.money(placement.cost)}" if placement.cost else ""
        described.append(f"{name}{where}{price}")
    return Answer(
        Intent.PLACEMENTS,
        f"You've placed {speech.count(len(described), 'upgrade')}: {speech.join(described)}.",
    )


def _objectives(context: SceneContext) -> Answer:
    if not context.objectives:
        return Answer(
            Intent.OBJECTIVES,
            "No objectives are set for this level.",
            grounded=False,
            missing=("objectives",),
        )
    met = [item for item in context.objectives if item.met]
    parts = [
        f"You've met {speech.number(len(met))} of "
        f"{speech.count(len(context.objectives), 'objective')}."
    ]
    for item in context.objectives:
        status = "done" if item.met else "still open"
        detail = f" {speech.speakable(item.detail).rstrip('.')}." if item.detail else ""
        parts.append(f"{speech.speakable(item.label).rstrip('.')}, {status}.{detail}")
    return Answer(Intent.OBJECTIVES, " ".join(parts))


def _help(context: SceneContext) -> Answer:
    return Answer(
        Intent.HELP,
        "Ask me about this map. How safe is the route, what street is this, "
        "what does the crash history show, what did the simulation find, "
        "what have I built, how much budget is left, or what are my objectives.",
    )


def _out_of_scope(context: SceneContext) -> Answer:
    return Answer(Intent.OUT_OF_SCOPE, _SCOPE_REDIRECT, grounded=False)


_HANDLERS = {
    Intent.ROUTE_SAFETY: _route_safety,
    Intent.STREET_NAME: _street_name,
    Intent.INTERSECTION_SUMMARY: _intersection_summary,
    Intent.SIMULATION_SUMMARY: _simulation_summary,
    Intent.WARNINGS: _warnings,
    Intent.CRASH_HISTORY: _crash_history,
    Intent.BUDGET: _budget,
    Intent.PLACEMENTS: _placements,
    Intent.OBJECTIVES: _objectives,
    Intent.HELP: _help,
    Intent.OUT_OF_SCOPE: _out_of_scope,
}
