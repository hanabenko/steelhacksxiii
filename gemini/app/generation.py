"""THE generation catalog for Interlock.

This is the only file that knows what Interlock asks Gemini to produce. Every
generation need across the project — the intersection briefing, the simulation
debrief, coaching, challenge scenarios, level objectives, intervention
rationale, voice intent routing, and route narration — is declared here as one
`GenerationTask`.

Everything else in `gemini/` is generic plumbing that never names a task:
`client.py` speaks HTTP to Google, `config.py` reads env vars, `main.py`
exposes `POST /generate/{task_id}` over whatever this catalog contains. Adding
or changing a generation need means editing THIS FILE ONLY.

Each task declares:

  id                   stable key used by the API route and the frontend
  title / purpose      what it is for, in plain words
  used_by              where in the project the output is consumed
  system_instruction   the model's standing rules for this task
  schema               Gemini `responseSchema`, so output is structured JSON
  temperature          overrides the global default when a task wants range
  build_prompt         turns a payload dict into the user prompt
  facts                the numbers the model is allowed to state
  fallback             deterministic output when Gemini is off or fails

Grounding rule enforced throughout: Gemini writes *prose*, never *numbers*.
Every figure is computed upstream (crash data, SUMO, the scoring engine),
injected into the prompt as a FACTS block, and the model is told to reuse those
figures verbatim and invent no others. `unverified_numbers()` then checks the
output and reports any digit that did not come from the payload, so a drifting
model is visible rather than silently believed.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

Payload = dict[str, Any]

# --- Shared prompt furniture ----------------------------------------------

_GROUNDING_RULES = """
Hard rules:
- Use ONLY the figures in the FACTS block. Never introduce a number that is not
  there, and never round one into a different number.
- If a fact you would need is absent, say the data is not loaded. Do not guess.
- Never describe a simulated figure as a prediction, a crash forecast, or a
  measured real-world effect. Simulated values come from a traffic model.
- Recorded crash counts are historical data. Keep that distinction explicit.
- Write plainly for a member of the public. No jargon unless the FACTS use it.
""".strip()


def _facts_block(pairs: Iterable[tuple[str, Any]]) -> str:
    """Render the caller's numbers as the only figures the model may use."""
    lines = [f"- {label}: {value}" for label, value in pairs if value not in (None, "", [])]
    return "FACTS\n" + ("\n".join(lines) if lines else "- none supplied")


def _get(payload: Payload, *path: str, default: Any = None) -> Any:
    """Safe nested lookup: `_get(p, 'results', 'after', 'risk', 'mean')`."""
    current: Any = payload
    for key in path:
        if not isinstance(current, dict) or key not in current:
            return default
        current = current[key]
    return current if current is not None else default


def _metric_pairs(payload: Payload) -> list[tuple[str, Any]]:
    """Before/after figures shared by the debrief and coaching tasks."""
    labels = {
        "risk": "conflict proxy per 1,000 vehicles",
        "speed": "average speed (mph)",
        "delay": "delay (seconds per vehicle)",
        "throughput": "throughput (vehicles per hour)",
        "access": "pedestrian access index (0-100)",
    }
    pairs: list[tuple[str, Any]] = []
    for key, label in labels.items():
        before = _get(payload, "results", "before", key, "mean")
        after = _get(payload, "results", "after", key, "mean")
        if before is None and after is None:
            continue
        pairs.append((f"{label} before", before))
        pairs.append((f"{label} after", after))
    for key, label in [("score", "overall score (0-100)"), ("runs", "Monte Carlo trials")]:
        pairs.append((label, _get(payload, "results", key)))
    pairs.append(("simulation engine", _get(payload, "results", "engine")))
    return pairs


def _placement_lines(payload: Payload) -> str:
    placements = payload.get("placements") or []
    if not placements:
        return "- none placed yet"
    lines = []
    for item in placements:
        cost = item.get("cost")
        suffix = f" costing {cost}" if cost is not None else ""
        lines.append(
            f"- {item.get('type', 'upgrade')} on the "
            f"{item.get('zone', 'unspecified')} approach{suffix}"
        )
    return "\n".join(lines)


@dataclass(frozen=True)
class GenerationTask:
    id: str
    title: str
    purpose: str
    used_by: str
    schema: dict[str, Any]
    build_prompt: Callable[[Payload], str]
    fallback: Callable[[Payload], dict[str, Any]]
    system_instruction: str = ""
    facts: Callable[[Payload], list[tuple[str, Any]]] = field(default=lambda _: [])
    temperature: float | None = None

    def describe(self) -> dict[str, str]:
        return {
            "id": self.id,
            "title": self.title,
            "purpose": self.purpose,
            "used_by": self.used_by,
        }


# ===========================================================================
# 1. Intersection briefing
# ===========================================================================

def _briefing_facts(payload: Payload) -> list[tuple[str, Any]]:
    return [
        ("intersection", payload.get("intersection_name")),
        ("streets", ", ".join(payload.get("streets") or [])),
        ("posted speed limit (mph)", payload.get("speed_limit_mph")),
        ("recorded crashes", _get(payload, "crash_history", "total")),
        ("of those, injury crashes", _get(payload, "crash_history", "injury")),
        ("of those, severe crashes", _get(payload, "crash_history", "severe")),
        ("of those, pedestrian or cyclist", _get(payload, "crash_history", "vulnerable_road_user")),
        ("crash search radius (meters)", _get(payload, "crash_history", "radius_meters")),
        ("crash data period", _get(payload, "crash_history", "period")),
        ("on the city High Injury Network", _get(payload, "crash_history", "high_injury_network")),
        ("average daily traffic", payload.get("average_daily_traffic")),
        ("median observed speed (mph)", payload.get("median_speed_mph")),
        ("85th percentile speed (mph)", payload.get("p85_speed_mph")),
    ]


INTERSECTION_BRIEFING = GenerationTask(
    id="intersection_briefing",
    title="Intersection briefing",
    purpose=(
        "Two or three sentences introducing a real intersection and why it was "
        "selected, plus the specific problems a player should look at."
    ),
    used_by=(
        "Frontend intro panel when a level loads; also feeds the voice layer's "
        "intersection_summary intent when a richer description is wanted."
    ),
    system_instruction=(
        "You brief a member of the public on a Pittsburgh intersection they are "
        "about to redesign in a game. Be concrete and calm. Never alarmist.\n\n"
        + _GROUNDING_RULES
    ),
    facts=_briefing_facts,
    schema={
        "type": "object",
        "properties": {
            "headline": {"type": "string", "description": "Under 60 characters."},
            "briefing": {"type": "string", "description": "2-3 sentences."},
            "focus_points": {
                "type": "array",
                "items": {"type": "string"},
                "description": "2-4 short things to look at, each under 12 words.",
            },
        },
        "required": ["headline", "briefing", "focus_points"],
    },
    build_prompt=lambda p: (
        f"{_facts_block(_briefing_facts(p))}\n\n"
        "Write a headline, a short briefing, and the focus points a player "
        "should examine first at this intersection."
    ),
    fallback=lambda p: {
        "headline": p.get("intersection_name") or "Intersection briefing",
        "briefing": (
            f"{p.get('intersection_name') or 'This intersection'} was selected for its "
            "crash history and data coverage. Review the recorded crash figures in the "
            "data panel before making changes."
        ),
        "focus_points": ["Crosswalk coverage", "Approach speeds", "Recorded crash history"],
    },
)


# ===========================================================================
# 2. Simulation debrief
# ===========================================================================

SIMULATION_DEBRIEF = GenerationTask(
    id="simulation_debrief",
    title="Simulation debrief",
    purpose=(
        "Turn before/after Monte Carlo metrics into a short readable verdict, "
        "including the trade-off the player actually made."
    ),
    used_by=(
        "Frontend Impact panel beneath the comparison table; the text is also "
        "short enough for the voice layer to read aloud after a run."
    ),
    system_instruction=(
        "You explain traffic simulation results to a player. Name the trade-off "
        "honestly: if safety improved while throughput fell, say so.\n\n"
        + _GROUNDING_RULES
    ),
    facts=_metric_pairs,
    schema={
        "type": "object",
        "properties": {
            "verdict": {"type": "string", "description": "One sentence."},
            "what_improved": {"type": "array", "items": {"type": "string"}},
            "what_got_worse": {"type": "array", "items": {"type": "string"}},
            "tradeoff": {"type": "string", "description": "One sentence, or empty."},
            "spoken_summary": {
                "type": "string",
                "description": "Under 45 words, for text to speech. No symbols.",
            },
        },
        "required": ["verdict", "what_improved", "what_got_worse", "spoken_summary"],
    },
    build_prompt=lambda p: (
        f"{_facts_block(_metric_pairs(p))}\n\n"
        f"Upgrades the player placed:\n{_placement_lines(p)}\n\n"
        "Explain what this design did. Separate genuine improvements from "
        "regressions, and state the trade-off plainly."
    ),
    fallback=lambda p: {
        "verdict": "Simulation complete. Compare the before and after columns for details.",
        "what_improved": [],
        "what_got_worse": [],
        "tradeoff": "",
        "spoken_summary": "Your simulation finished. Check the comparison table for the results.",
    },
)


# ===========================================================================
# 3. Design coaching
# ===========================================================================

def _coaching_facts(payload: Payload) -> list[tuple[str, Any]]:
    return _metric_pairs(payload) + [
        ("budget total", _get(payload, "budget", "total")),
        ("budget spent", _get(payload, "budget", "spent")),
        ("budget remaining", _get(payload, "budget", "remaining")),
    ]


DESIGN_COACHING = GenerationTask(
    id="design_coaching",
    title="Design coaching",
    purpose=(
        "Suggest the next move: which upgrade to try, where, and what it should "
        "improve — constrained by the money actually left."
    ),
    used_by="Game loop between attempts; the 'what should I try next' affordance.",
    system_instruction=(
        "You coach a player iterating on an intersection design. Give at most "
        "three suggestions, each affordable within the remaining budget. Never "
        "promise an outcome; say what a change is intended to affect.\n\n"
        + _GROUNDING_RULES
    ),
    facts=_coaching_facts,
    temperature=0.5,
    schema={
        "type": "object",
        "properties": {
            "assessment": {"type": "string", "description": "One sentence."},
            "suggestions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "action": {"type": "string", "description": "Under 15 words."},
                        "rationale": {"type": "string", "description": "One sentence."},
                        "targets": {
                            "type": "string",
                            "enum": ["safety", "throughput", "pedestrian_access", "budget"],
                        },
                    },
                    "required": ["action", "rationale", "targets"],
                },
            },
        },
        "required": ["assessment", "suggestions"],
    },
    build_prompt=lambda p: (
        f"{_facts_block(_coaching_facts(p))}\n\n"
        f"Already placed:\n{_placement_lines(p)}\n\n"
        f"Available upgrades and costs:\n"
        + (
            "\n".join(
                f"- {item.get('type')}: {item.get('cost')}"
                for item in (p.get("catalog") or [])
            )
            or "- catalog not supplied"
        )
        + "\n\nAssess the current design and suggest up to three next moves that "
        "fit the remaining budget."
    ),
    fallback=lambda p: {
        "assessment": "Run a simulation, then adjust one upgrade at a time to see its effect.",
        "suggestions": [],
    },
)


# ===========================================================================
# 4. Challenge scenario
# ===========================================================================

CHALLENGE_SCENARIO = GenerationTask(
    id="challenge_scenario",
    title="Challenge scenario",
    purpose=(
        "Generate a playable scenario — rush hour, pedestrian surge, road "
        "closure — as both flavour text and concrete simulation settings."
    ),
    used_by="Game log / level select. Settings feed straight into the simulation request.",
    system_instruction=(
        "You design short scenarios for a traffic game. Settings must be "
        "plausible for a single urban intersection. Keep the framing factual; "
        "this is a real street, not a disaster movie.\n\n"
        + _GROUNDING_RULES
    ),
    temperature=0.8,
    schema={
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Under 40 characters."},
            "premise": {"type": "string", "description": "2 sentences."},
            "settings": {
                "type": "object",
                "properties": {
                    "demand": {"type": "integer", "description": "Vehicles per hour, 200-2000."},
                    "green": {"type": "integer", "description": "Main-street green seconds, 15-60."},
                    "av": {"type": "integer", "description": "AV adoption percent, 0-100."},
                    "pedestrian_multiplier": {"type": "number", "description": "1.0 is normal."},
                },
                "required": ["demand", "green", "av", "pedestrian_multiplier"],
            },
            "success_criteria": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["name", "premise", "settings", "success_criteria"],
    },
    build_prompt=lambda p: (
        f"{_facts_block([('intersection', p.get('intersection_name')), ('streets', ', '.join(p.get('streets') or [])), ('budget', _get(p, 'budget', 'total'))])}\n\n"
        f"Scenario theme requested: {p.get('theme') or 'any'}\n"
        f"Difficulty: {p.get('difficulty') or 'medium'}\n\n"
        "Produce one scenario with concrete simulation settings and success criteria."
    ),
    fallback=lambda p: {
        "name": "Weekday rush hour",
        "premise": (
            "Evening peak traffic builds on the main street while people cross on foot. "
            "Keep traffic moving without making the crossing worse."
        ),
        "settings": {"demand": 1200, "green": 40, "av": 0, "pedestrian_multiplier": 1.5},
        "success_criteria": [
            "Reduce the conflict proxy against baseline",
            "Retain at least 90 percent of baseline throughput",
        ],
    },
)


# ===========================================================================
# 5. Level objectives
# ===========================================================================

LEVEL_OBJECTIVES = GenerationTask(
    id="level_objectives",
    title="Level objectives",
    purpose="Write the scoring objectives and budget framing for a level.",
    used_by="Game log when a level is created; rendered in the objectives panel.",
    system_instruction=(
        "You write objectives for a traffic design game. Each objective must be "
        "checkable against a simulation metric the game already computes: "
        "conflict proxy, average speed, delay, throughput, pedestrian access, "
        "or budget spent.\n\n" + _GROUNDING_RULES
    ),
    temperature=0.6,
    schema={
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "objectives": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string", "description": "Under 12 words."},
                        "metric": {
                            "type": "string",
                            "enum": ["risk", "speed", "delay", "throughput", "access", "budget"],
                        },
                        "comparison": {"type": "string", "enum": ["at_least", "at_most"]},
                        "target": {"type": "number"},
                        "unit": {"type": "string"},
                    },
                    "required": ["label", "metric", "comparison", "target", "unit"],
                },
            },
        },
        "required": ["title", "objectives"],
    },
    build_prompt=lambda p: (
        f"{_facts_block([('intersection', p.get('intersection_name')), ('budget', _get(p, 'budget', 'total')), ('difficulty', p.get('difficulty'))])}\n\n"
        f"Baseline metrics:\n{_facts_block(_metric_pairs(p))}\n\n"
        "Write a level title and three measurable objectives."
    ),
    fallback=lambda p: {
        "title": "Make the crossing safer",
        "objectives": [
            {
                "label": "Cut the conflict proxy by a fifth",
                "metric": "risk",
                "comparison": "at_most",
                "target": 80,
                "unit": "percent of baseline",
            },
            {
                "label": "Keep traffic moving",
                "metric": "throughput",
                "comparison": "at_least",
                "target": 90,
                "unit": "percent of baseline",
            },
        ],
    },
)


# ===========================================================================
# 6. Intervention rationale
# ===========================================================================

def _intervention_facts(payload: Payload) -> list[tuple[str, Any]]:
    study = payload.get("study") or {}
    return [
        ("intervention", payload.get("intervention_type")),
        ("study location", study.get("street")),
        ("measured average daily traffic before", study.get("before_adt")),
        ("measured average daily traffic after", study.get("after_adt")),
        ("measured median speed before (mph)", study.get("before_median_speed")),
        ("measured median speed after (mph)", study.get("after_median_speed")),
        ("measured 85th percentile speed before (mph)", study.get("before_p85_speed")),
        ("measured 85th percentile speed after (mph)", study.get("after_p85_speed")),
        ("measured percent speeding before", study.get("before_pct_speeding")),
        ("measured percent speeding after", study.get("after_pct_speeding")),
        ("study source", study.get("source_url")),
    ]


INTERVENTION_RATIONALE = GenerationTask(
    id="intervention_rationale",
    title="Intervention rationale",
    purpose=(
        "Explain in plain language what an upgrade does, anchored to the real "
        "Pittsburgh before/after study in data/manual/interventions.csv."
    ),
    used_by="Infrastructure cards in the Design panel; the 'why does this help' affordance.",
    system_instruction=(
        "You explain a street design treatment to a member of the public. When a "
        "real measured study is supplied, cite its figures and name it as a "
        "single local study, not proof of a general effect.\n\n" + _GROUNDING_RULES
    ),
    facts=_intervention_facts,
    schema={
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "1-2 sentences."},
            "benefit": {"type": "string", "description": "One sentence."},
            "tradeoff": {"type": "string", "description": "One sentence."},
            "evidence_note": {
                "type": "string",
                "description": "What the cited study does and does not show.",
            },
        },
        "required": ["summary", "benefit", "tradeoff", "evidence_note"],
    },
    build_prompt=lambda p: (
        f"{_facts_block(_intervention_facts(p))}\n\n"
        "Explain this treatment, its main benefit, its trade-off, and what the "
        "cited measurement does and does not establish."
    ),
    fallback=lambda p: {
        "summary": f"{p.get('intervention_type', 'This upgrade')} changes how the street is used.",
        "benefit": "See the infrastructure card for the modelled benefit.",
        "tradeoff": "See the infrastructure card for the modelled trade-off.",
        "evidence_note": "No measured study is loaded for this treatment.",
    },
)


# ===========================================================================
# 7. Voice intent router
# ===========================================================================
# Bridges free-form speech to the voice service's CLOSED intent set. Gemini
# only chooses a label; it never states a fact. The voice layer still builds
# the answer from its own grounded context, so this cannot leak invented data.

VOICE_INTENTS = [
    "route_safety",
    "street_name",
    "intersection_summary",
    "simulation_summary",
    "warnings",
    "crash_history",
    "budget",
    "placements",
    "objectives",
    "help",
    "out_of_scope",
]

VOICE_INTENT_ROUTER = GenerationTask(
    id="voice_intent_router",
    title="Voice intent router",
    purpose=(
        "Classify a spoken utterance into the voice service's fixed intent set "
        "when the keyword matcher returns out_of_scope. Label only — no facts."
    ),
    used_by=(
        "voice/ as an optional fallback before refusing a question, so "
        "paraphrases still work while answers stay template-generated."
    ),
    system_instruction=(
        "You are a classifier. Return exactly one intent from the allowed list "
        "and nothing else. If the utterance is not about this intersection, the "
        "player's design, or their route, return out_of_scope. Never answer the "
        "question itself."
    ),
    temperature=0.0,
    schema={
        "type": "object",
        "properties": {
            "intent": {"type": "string", "enum": VOICE_INTENTS},
            "confidence": {"type": "number", "description": "0.0 to 1.0."},
        },
        "required": ["intent", "confidence"],
    },
    build_prompt=lambda p: (
        f"Allowed intents: {', '.join(VOICE_INTENTS)}\n\n"
        f"Utterance: {p.get('utterance', '')!r}\n\n"
        "Return the single best intent."
    ),
    fallback=lambda p: {"intent": "out_of_scope", "confidence": 0.0},
)


# ===========================================================================
# 8. Route safety narrative
# ===========================================================================

def _route_facts(payload: Payload) -> list[tuple[str, Any]]:
    pairs: list[tuple[str, Any]] = [("destination", _get(payload, "route", "destination"))]
    for index, leg in enumerate(_get(payload, "route", "legs", default=[]) or [], start=1):
        pairs.append((f"leg {index} street", leg.get("street")))
        pairs.append((f"leg {index} speed limit (mph)", leg.get("speed_limit_mph")))
        pairs.append((f"leg {index} marked crosswalk", leg.get("has_crosswalk")))
        pairs.append((f"leg {index} bike lane", leg.get("has_bike_lane")))
        pairs.append((f"leg {index} recorded crashes", leg.get("crash_count")))
    return pairs


ROUTE_SAFETY_NARRATIVE = GenerationTask(
    id="route_safety_narrative",
    title="Route safety narrative",
    purpose=(
        "A warmer, spoken-length version of the route walkthrough for questions "
        "like 'how safe is the path to my school'."
    ),
    used_by=(
        "voice/ route_safety intent, when a narrative reading is preferred over "
        "the deterministic template."
    ),
    system_instruction=(
        "You describe a walking route past a real intersection. Name every "
        "street from the FACTS in order. Flag missing crosswalks and high crash "
        "counts. Do not reassure beyond what the facts support. Write for text "
        "to speech: no symbols, no abbreviations, spell out units.\n\n"
        + _GROUNDING_RULES
    ),
    facts=_route_facts,
    schema={
        "type": "object",
        "properties": {
            "narrative": {"type": "string", "description": "Under 70 words, for speech."},
            "cautions": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["narrative", "cautions"],
    },
    build_prompt=lambda p: (
        f"{_facts_block(_route_facts(p))}\n\n"
        "Narrate this route in order and list any cautions."
    ),
    fallback=lambda p: {
        "narrative": "Route details are not loaded. Pick a route on the map to hear it described.",
        "cautions": [],
    },
)


# ===========================================================================
# Registry
# ===========================================================================

TASKS: dict[str, GenerationTask] = {
    task.id: task
    for task in (
        INTERSECTION_BRIEFING,
        SIMULATION_DEBRIEF,
        DESIGN_COACHING,
        CHALLENGE_SCENARIO,
        LEVEL_OBJECTIVES,
        INTERVENTION_RATIONALE,
        VOICE_INTENT_ROUTER,
        ROUTE_SAFETY_NARRATIVE,
    )
}


def get_task(task_id: str) -> GenerationTask | None:
    return TASKS.get(task_id)


def catalog() -> list[dict[str, str]]:
    """Every generation Interlock needs, for docs and UI discovery."""
    return [task.describe() for task in TASKS.values()]


# --- Output verification ---------------------------------------------------

_NUMBER = re.compile(r"\d+(?:\.\d+)?")
# Small integers appear as ordinals and list positions; they are not claims.
_ALWAYS_ALLOWED = {"0", "1", "2", "3", "4", "5"}


def _numbers_in(value: Any) -> set[str]:
    """Every numeric token reachable inside an arbitrary payload or result."""
    found: set[str] = set()
    if isinstance(value, bool):
        return found
    if isinstance(value, (int, float)):
        text = f"{value}"
        found.add(text)
        if text.endswith(".0"):
            found.add(text[:-2])
        return found
    if isinstance(value, str):
        found.update(_NUMBER.findall(value))
        return found
    if isinstance(value, dict):
        for key, item in value.items():
            found.update(_numbers_in(key))
            found.update(_numbers_in(item))
        return found
    if isinstance(value, (list, tuple, set)):
        for item in value:
            found.update(_numbers_in(item))
    return found


def unverified_numbers(result: dict[str, Any], payload: Payload) -> list[str]:
    """Numbers the model stated that were not in its input.

    An empty list means every figure in the output traces back to real upstream
    data. A non-empty list is a drift signal: the API surfaces it rather than
    silently trusting the text.
    """
    allowed = _numbers_in(payload) | _ALWAYS_ALLOWED
    # A bare integer and its float spelling are the same claim.
    for number in list(allowed):
        if number.endswith(".0"):
            allowed.add(number[:-2])
        else:
            allowed.add(f"{number}.0")
    return sorted(_numbers_in(result) - allowed)
