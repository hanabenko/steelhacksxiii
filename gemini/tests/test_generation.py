"""Catalog, prompt, schema and grounding tests. No network, no API key.

    cd gemini && ./.venv/bin/python -m unittest discover tests -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.generation import (  # noqa: E402
    TASKS,
    VOICE_INTENTS,
    catalog,
    get_task,
    unverified_numbers,
)

SCENE = {
    "intersection_name": "Fifth Avenue and Meyran Avenue",
    "streets": ["Fifth Avenue", "Meyran Avenue"],
    "speed_limit_mph": 25,
    "crash_history": {
        "radius_meters": 150, "total": 114, "injury": 53,
        "severe": 2, "vulnerable_road_user": 25, "high_injury_network": True,
    },
    "budget": {"total": 100000, "spent": 20000, "remaining": 80000},
    "placements": [{"type": "raised_crosswalk", "zone": "north", "cost": 12000}],
    "results": {
        "engine": "sumo-1.27", "runs": 100, "score": 57,
        "before": {"risk": {"mean": 12}, "speed": {"mean": 29}, "throughput": {"mean": 800}},
        "after": {"risk": {"mean": 9}, "speed": {"mean": 26}, "throughput": {"mean": 780}},
    },
    "route": {
        "destination": "school",
        "legs": [
            {"street": "Fifth Avenue", "speed_limit_mph": 25, "has_crosswalk": True},
            {"street": "Meyran Avenue", "has_crosswalk": False, "crash_count": 12},
        ],
    },
}


class TestCatalog(unittest.TestCase):
    def test_every_task_is_fully_declared(self) -> None:
        for task_id, task in TASKS.items():
            with self.subTest(task=task_id):
                self.assertEqual(task.id, task_id)
                self.assertTrue(task.title)
                self.assertTrue(task.purpose)
                self.assertTrue(task.used_by, "each task must say where it is consumed")
                self.assertTrue(callable(task.build_prompt))
                self.assertTrue(callable(task.fallback))

    def test_catalog_matches_the_registry(self) -> None:
        self.assertEqual({item["id"] for item in catalog()}, set(TASKS))

    def test_unknown_task_is_none(self) -> None:
        self.assertIsNone(get_task("no_such_task"))


class TestSchemas(unittest.TestCase):
    """Schemas must be the OpenAPI subset Gemini's responseSchema accepts."""

    ALLOWED_TYPES = {"object", "array", "string", "number", "integer", "boolean"}

    def _walk(self, node: dict, path: str) -> None:
        self.assertIn("type", node, f"{path} needs a type")
        self.assertIn(node["type"], self.ALLOWED_TYPES, f"{path} has an unsupported type")
        if node["type"] == "object":
            self.assertIn("properties", node, f"{path} object needs properties")
            for name, child in node["properties"].items():
                self._walk(child, f"{path}.{name}")
            for required in node.get("required", []):
                self.assertIn(required, node["properties"], f"{path} requires unknown {required}")
        if node["type"] == "array":
            self.assertIn("items", node, f"{path} array needs items")
            self._walk(node["items"], f"{path}[]")

    def test_all_schemas_are_valid(self) -> None:
        for task_id, task in TASKS.items():
            with self.subTest(task=task_id):
                self.assertEqual(task.schema.get("type"), "object", "top level must be an object")
                self._walk(task.schema, task_id)

    def test_schemas_declare_required_fields(self) -> None:
        for task_id, task in TASKS.items():
            with self.subTest(task=task_id):
                self.assertTrue(task.schema.get("required"), "output contract must be required")


class TestPrompts(unittest.TestCase):
    def test_every_prompt_builds_from_a_full_scene(self) -> None:
        payload = {**SCENE, "utterance": "is the walk safe", "intervention_type": "bike_lane"}
        for task_id, task in TASKS.items():
            with self.subTest(task=task_id):
                prompt = task.build_prompt(payload)
                self.assertIsInstance(prompt, str)
                self.assertTrue(prompt.strip())

    def test_every_prompt_survives_an_empty_payload(self) -> None:
        for task_id, task in TASKS.items():
            with self.subTest(task=task_id):
                self.assertTrue(task.build_prompt({}).strip())

    def test_prompts_carry_the_supplied_figures(self) -> None:
        prompt = TASKS["intersection_briefing"].build_prompt(SCENE)
        self.assertIn("114", prompt)
        self.assertIn("Fifth Avenue", prompt)
        self.assertIn("FACTS", prompt)

    def test_grounded_tasks_forbid_invented_numbers(self) -> None:
        grounded = [
            "intersection_briefing", "simulation_debrief", "design_coaching",
            "intervention_rationale", "route_safety_narrative",
        ]
        for task_id in grounded:
            with self.subTest(task=task_id):
                self.assertIn("ONLY the figures", TASKS[task_id].system_instruction)

    def test_route_prompt_lists_every_leg_in_order(self) -> None:
        prompt = TASKS["route_safety_narrative"].build_prompt(SCENE)
        self.assertLess(prompt.index("Fifth Avenue"), prompt.index("Meyran Avenue"))

    def test_intent_router_offers_only_the_closed_set(self) -> None:
        task = TASKS["voice_intent_router"]
        self.assertEqual(task.schema["properties"]["intent"]["enum"], VOICE_INTENTS)
        self.assertEqual(task.temperature, 0.0, "classification must be deterministic")
        self.assertIn("Never answer the question itself", task.system_instruction)


class TestFallbacks(unittest.TestCase):
    def test_fallbacks_satisfy_their_own_schema(self) -> None:
        for task_id, task in TASKS.items():
            with self.subTest(task=task_id):
                result = task.fallback(SCENE)
                self.assertIsInstance(result, dict)
                for required in task.schema.get("required", []):
                    self.assertIn(required, result, f"{task_id} fallback misses {required}")

    def test_fallbacks_work_with_no_data_at_all(self) -> None:
        for task_id, task in TASKS.items():
            with self.subTest(task=task_id):
                for required in task.schema.get("required", []):
                    self.assertIn(required, task.fallback({}))

    def test_intent_router_fallback_refuses_rather_than_guesses(self) -> None:
        self.assertEqual(TASKS["voice_intent_router"].fallback({})["intent"], "out_of_scope")


class TestGroundingVerification(unittest.TestCase):
    def test_echoed_figures_are_accepted(self) -> None:
        result = {"briefing": "There are 114 recorded crashes, 53 of them with injuries."}
        self.assertEqual(unverified_numbers(result, SCENE), [])

    def test_invented_figures_are_reported(self) -> None:
        result = {"briefing": "Crashes will fall by 47 percent next year."}
        self.assertIn("47", unverified_numbers(result, SCENE))

    def test_small_ordinals_are_not_flagged(self) -> None:
        result = {"briefing": "There are 3 things to look at."}
        self.assertEqual(unverified_numbers(result, SCENE), [])

    def test_float_and_integer_spellings_are_the_same_claim(self) -> None:
        self.assertEqual(unverified_numbers({"t": "speed was 25"}, {"speed": 25.0}), [])
        self.assertEqual(unverified_numbers({"t": "speed was 25.0"}, {"speed": 25}), [])

    def test_nested_payload_numbers_are_reachable(self) -> None:
        result = {"summary": "Throughput moved from 800 to 780 across 100 trials."}
        self.assertEqual(unverified_numbers(result, SCENE), [])

    def test_booleans_contribute_no_allowed_numbers(self) -> None:
        # `True` must not silently authorize "1" (or any figure) in the output.
        self.assertEqual(unverified_numbers({"t": "the value was 7"}, {"flag": True}), ["7"])

    def test_numbers_inside_payload_strings_count_as_supplied(self) -> None:
        payload = {"period": "2004 to 2025"}
        self.assertEqual(unverified_numbers({"t": "covering 2004 to 2025"}, payload), [])


if __name__ == "__main__":
    unittest.main()
