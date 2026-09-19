"""Scene context supplied by the caller.

Every spoken answer is generated from one of these objects. The voice service
holds no state and invents no facts: if a field is absent, the matching intent
says it does not know rather than guessing. This is what keeps the assistant
tied to the map and the game.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class Metric(BaseModel):
    """One simulated measure with its uncertainty, matching the frontend."""

    mean: float
    ci: float = 0.0


class MetricSet(BaseModel):
    risk: Metric | None = None
    speed: Metric | None = None
    delay: Metric | None = None
    throughput: Metric | None = None
    access: Metric | None = None


class SimulationResults(BaseModel):
    engine: str | None = None
    before: MetricSet | None = None
    after: MetricSet | None = None
    reduction: float | None = None
    retained: float | None = None
    score: float | None = None
    runs: int | None = None
    seed: int | None = None
    stale: bool = Field(
        default=False,
        description="True when the design changed after these results were produced.",
    )


class Placement(BaseModel):
    type: str
    zone: str | None = None
    label: str | None = None
    cost: float | None = None


class Budget(BaseModel):
    total: float | None = None
    spent: float | None = None

    @property
    def remaining(self) -> float | None:
        if self.total is None or self.spent is None:
            return None
        return self.total - self.spent


class CrashHistory(BaseModel):
    """Observed counts from the Pittsburgh crash data, never model output."""

    radius_meters: int | None = None
    total: int | None = None
    injury: int | None = None
    severe: int | None = None
    vulnerable_road_user: int | None = None
    period: str | None = None
    high_injury_network: bool | None = None


class RouteLeg(BaseModel):
    street: str
    from_street: str | None = None
    to_street: str | None = None
    has_crosswalk: bool | None = None
    has_bike_lane: bool | None = None
    speed_limit_mph: float | None = None
    crash_count: int | None = None


class Route(BaseModel):
    """An explicit path through the scene, e.g. a walk to school."""

    name: str | None = None
    destination: str | None = None
    legs: list[RouteLeg] = Field(default_factory=list)


class Objective(BaseModel):
    label: str
    met: bool | None = None
    detail: str | None = None


class SceneContext(BaseModel):
    """Everything the voice is allowed to talk about."""

    intersection_id: str | None = None
    intersection_name: str | None = None
    streets: list[str] = Field(default_factory=list)
    focused_street: str | None = None
    focused_zone: str | None = None
    speed_limit_mph: float | None = None

    budget: Budget | None = None
    placements: list[Placement] = Field(default_factory=list)
    objectives: list[Objective] = Field(default_factory=list)
    results: SimulationResults | None = None
    crash_history: CrashHistory | None = None
    route: Route | None = None
    warnings: list[str] = Field(default_factory=list)

    data_note: str | None = Field(
        default=None,
        description="Provenance caveat appended to safety answers when supplied.",
    )
