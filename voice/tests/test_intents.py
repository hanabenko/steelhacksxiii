"""Intent routing and grounding tests. No network, no API key required.

    cd voice && python3 -m unittest discover tests -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.context import (  # noqa: E402
    Budget,
    CrashHistory,
    Metric,
    MetricSet,
    Objective,
    Placement,
    Route,
    RouteLeg,
    SceneContext,
    SimulationResults,
)
from app.intents import Intent, answer, classify  # noqa: E402
from app import speech  # noqa: E402


class TestClassification(unittest.TestCase):
    def test_maps_questions_to_expected_intents(self) -> None:
        cases = {
            "How safe is the path to my school?": Intent.ROUTE_SAFETY,
            "is it safe to walk here": Intent.ROUTE_SAFETY,
            "What street is this?": Intent.STREET_NAME,
            "where am I": Intent.STREET_NAME,
            "have there been any crashes here": Intent.CRASH_HISTORY,
            "how did my design do": Intent.SIMULATION_SUMMARY,
            "how much budget is left": Intent.BUDGET,
            "what have I built": Intent.PLACEMENTS,
            "what are my objectives": Intent.OBJECTIVES,
            "any dangers here": Intent.WARNINGS,
            "tell me about this intersection": Intent.INTERSECTION_SUMMARY,
            "what can you do": Intent.HELP,
        }
        for question, expected in cases.items():
            with self.subTest(question=question):
                self.assertEqual(classify(question), expected)

    def test_off_topic_questions_are_refused(self) -> None:
        for question in [
            "write me a poem about Pittsburgh",
            "what is the capital of France",
            "who won the game last night",
            "",
        ]:
            with self.subTest(question=question):
                self.assertEqual(classify(question), Intent.OUT_OF_SCOPE)

    def test_out_of_scope_reply_redirects_to_the_map(self) -> None:
        result = answer("tell me a joke", SceneContext())
        self.assertFalse(result.grounded)
        self.assertIn("this intersection", result.text)


class TestGrounding(unittest.TestCase):
    """Absent context must produce an admission, never an invented answer."""

    def test_empty_context_never_asserts_facts(self) -> None:
        empty = SceneContext()
        for question, field in [
            ("how safe is my route to school", "route"),
            ("what street is this", "streets"),
            ("what did the simulation show", "results"),
            ("how many crashes here", "crash_history"),
            ("how much budget is left", "budget"),
            ("what are my objectives", "objectives"),
        ]:
            with self.subTest(question=question):
                result = answer(question, empty)
                self.assertFalse(result.grounded, result.text)
                self.assertIn(field, result.missing)

    def test_no_numbers_are_invented_for_an_empty_scene(self) -> None:
        result = answer("what did the simulation show", SceneContext())
        self.assertNotRegex(result.text, r"\d+\.\d")


class TestAnswers(unittest.TestCase):
    def test_route_safety_names_streets_and_flags_gaps(self) -> None:
        context = SceneContext(
            route=Route(
                destination="Central Catholic",
                legs=[
                    RouteLeg(street="Fifth Avenue", speed_limit_mph=25, has_crosswalk=True),
                    RouteLeg(street="Meyran Avenue", has_crosswalk=False, crash_count=12),
                ],
            ),
            data_note="Crash counts are recorded data, not a prediction.",
        )
        result = answer("how safe is the path to my school", context)
        self.assertTrue(result.grounded)
        self.assertIn("Central Catholic", result.text)
        self.assertIn("Fifth Avenue", result.text)
        self.assertIn("no marked crosswalk", result.text)
        self.assertIn("Take extra care on Meyran Avenue", result.text)
        self.assertIn("25 miles per hour", result.text)
        self.assertIn("not a prediction", result.text)

    def test_route_details_never_double_the_conjunction(self) -> None:
        context = SceneContext(
            route=Route(
                destination="school",
                legs=[
                    RouteLeg(
                        street="Meyran Avenue",
                        speed_limit_mph=25,
                        has_crosswalk=False,
                        has_bike_lane=True,
                        crash_count=12,
                    )
                ],
            )
        )
        text = answer("how safe is the walk to school", context).text
        self.assertNotIn("and and", text)
        self.assertIn("a bike lane and 12 recorded crashes", text)

    def test_clean_route_is_not_flagged(self) -> None:
        context = SceneContext(
            route=Route(destination="school", legs=[RouteLeg(street="Fifth Avenue", has_crosswalk=True)])
        )
        result = answer("is it safe to walk to school", context)
        self.assertIn("Nothing on this route is flagged", result.text)

    def test_focused_street_wins_over_the_street_list(self) -> None:
        context = SceneContext(
            streets=["Penn Avenue", "21st Street"], focused_street="Penn Avenue", focused_zone="north"
        )
        result = answer("what street is this", context)
        self.assertIn("Penn Avenue", result.text)
        self.assertIn("north", result.text)
        self.assertNotIn("21st Street", result.text)

    def test_simulation_summary_reads_before_and_after(self) -> None:
        context = SceneContext(
            results=SimulationResults(
                engine="sumo-1.27",
                runs=100,
                score=57,
                before=MetricSet(
                    risk=Metric(mean=12.0), speed=Metric(mean=29.0), throughput=Metric(mean=800)
                ),
                after=MetricSet(
                    risk=Metric(mean=9.0), speed=Metric(mean=26.0), throughput=Metric(mean=780)
                ),
            )
        )
        result = answer("how did my design do", context)
        self.assertIn("down", result.text)
        self.assertIn("57 out of 100", result.text)
        self.assertIn("100 trials", result.text)
        self.assertIn("sumo-1.27", result.text)

    def test_stale_results_are_announced_first(self) -> None:
        context = SceneContext(
            results=SimulationResults(
                stale=True,
                before=MetricSet(risk=Metric(mean=12.0)),
                after=MetricSet(risk=Metric(mean=9.0)),
            )
        )
        result = answer("results", context)
        self.assertTrue(result.text.startswith("Heads up"))

    def test_rising_risk_is_reported_as_up(self) -> None:
        context = SceneContext(
            results=SimulationResults(
                before=MetricSet(risk=Metric(mean=9.0)), after=MetricSet(risk=Metric(mean=12.0))
            )
        )
        self.assertIn("up", answer("results", context).text)

    def test_budget_reports_remaining_and_exhaustion(self) -> None:
        context = SceneContext(budget=Budget(total=100000, spent=100000))
        result = answer("how much budget is left", context)
        self.assertIn("100,000 dollars", result.text)
        self.assertIn("out of money", result.text)

    def test_crash_history_includes_breakdown_and_network_flag(self) -> None:
        context = SceneContext(
            crash_history=CrashHistory(
                radius_meters=150,
                total=114,
                injury=53,
                severe=2,
                vulnerable_road_user=25,
                high_injury_network=True,
            )
        )
        result = answer("crashes here", context)
        self.assertIn("114 crashes", result.text)
        self.assertIn("150 meters", result.text)
        self.assertIn("walking or biking", result.text)
        self.assertIn("High Injury Network", result.text)

    def test_warnings_are_numbered_and_normalized(self) -> None:
        context = SceneContext(warnings=["Over budget by $5,000", "TTC conflicts rose 12%"])
        result = answer("any problems", context)
        self.assertIn("2 warnings", result.text)
        self.assertIn("5,000 dollars", result.text)
        self.assertIn("time to collision", result.text)
        self.assertIn("12 percent", result.text)

    def test_no_warnings_says_so(self) -> None:
        self.assertIn("No warnings", answer("any dangers", SceneContext()).text)

    def test_placements_are_listed_with_zone_and_cost(self) -> None:
        context = SceneContext(
            placements=[
                Placement(type="raised_crosswalk", zone="north", cost=12000),
                Placement(type="bike_lane", zone="east", cost=8000),
            ]
        )
        result = answer("what have I built", context)
        self.assertIn("2 upgrades", result.text)
        self.assertIn("raised crosswalk on the north approach", result.text)
        self.assertIn("12,000 dollars", result.text)

    def test_objectives_report_progress(self) -> None:
        context = SceneContext(
            objectives=[
                Objective(label="Cut conflicts by 20%", met=True),
                Objective(label="Keep throughput above 90%", met=False),
            ]
        )
        result = answer("what are my objectives", context)
        self.assertIn("met 1 of 2 objectives", result.text)
        self.assertIn("done", result.text)
        self.assertIn("still open", result.text)


class TestSpeechFormatting(unittest.TestCase):
    def test_currency_and_units_are_spoken_not_symbolic(self) -> None:
        self.assertEqual(speech.money(100000), "100,000 dollars")
        self.assertEqual(speech.mph(25), "25 miles per hour")
        self.assertEqual(speech.seconds(1), "1 second")
        self.assertEqual(speech.seconds(3), "3 seconds")

    def test_join_uses_natural_language(self) -> None:
        self.assertEqual(speech.join(["a", "b", "c"]), "a, b and c")
        self.assertEqual(speech.join(["a"]), "a")
        self.assertEqual(speech.join([]), "")

    def test_answers_contain_no_unspoken_symbols(self) -> None:
        context = SceneContext(
            budget=Budget(total=100000, spent=25000),
            placements=[Placement(type="bike_lane", zone="east", cost=8000)],
        )
        for question in ["how much budget is left", "what have I built"]:
            with self.subTest(question=question):
                text = answer(question, context).text
                self.assertNotIn("$", text)
                self.assertNotIn("%", text)


if __name__ == "__main__":
    unittest.main()
