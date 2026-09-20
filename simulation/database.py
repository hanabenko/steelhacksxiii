"""Tiger Data persistence using Interlock's existing connection utility."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from psycopg.types.json import Jsonb

from simulation.interventions import Scenario
from simulation.models import AggregateSample, Calibration, RunMetrics, TTCEvent, VehicleState
from simulation.safety import SafetyConfig


def load_calibration(conn: Any, intersection_id: str) -> Calibration:
    row = conn.execute(
        """
        SELECT source_record_id, average_daily_car_traffic, median_speed_mph,
               p85_speed_mph, speed_limit_mph
        FROM traffic_observations
        WHERE intersection_id = %s
          AND average_daily_car_traffic IS NOT NULL
          AND median_speed_mph IS NOT NULL
          AND p85_speed_mph IS NOT NULL
          AND speed_limit_mph IS NOT NULL
        ORDER BY observed_at DESC
        LIMIT 1
        """,
        (intersection_id,),
    ).fetchone()
    if not row:
        raise RuntimeError(f"No complete traffic calibration record for {intersection_id}")
    return Calibration(
        source_record_id=row["source_record_id"],
        average_daily_traffic=float(row["average_daily_car_traffic"]),
        median_speed_mph=float(row["median_speed_mph"]),
        p85_speed_mph=float(row["p85_speed_mph"]),
        speed_limit_mph=float(row["speed_limit_mph"]),
    )


def create_run(
    conn: Any,
    run_id: uuid.UUID,
    scenario: Scenario,
    seed: int,
    started_at: datetime,
    config: dict[str, Any],
) -> None:
    conn.execute(
        """
        INSERT INTO simulation_runs (
            run_id, intersection_id, scenario_name, random_seed, status,
            started_at, intervention_config, simulation_config
        ) VALUES (%s, %s, %s, %s, 'running', %s, %s, %s)
        """,
        (
            run_id,
            scenario.intersection_id,
            scenario.name,
            seed,
            started_at,
            Jsonb(scenario.to_dict()),
            Jsonb(config),
        ),
    )
    conn.commit()


def persist_results(
    conn: Any,
    run_id: uuid.UUID,
    intersection_id: str,
    started_at: datetime,
    samples: list[AggregateSample],
    vehicle_states: list[VehicleState],
    ttc_events: list[TTCEvent],
    safety_config: SafetyConfig,
    metrics: RunMetrics,
    completed_at: datetime,
) -> None:
    with conn.transaction():
        conn.cursor().executemany(
            """
            INSERT INTO simulation_samples (
                simulated_at, run_id, intersection_id, simulation_time_s,
                mean_speed_mps, p95_speed_mps, mean_delay_s, mean_queue_length,
                active_vehicle_count, active_pedestrian_count,
                vehicles_completed, pedestrians_completed
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [
                (
                    started_at + timedelta(seconds=sample.simulation_time_s),
                    run_id,
                    intersection_id,
                    sample.simulation_time_s,
                    sample.mean_speed_mps,
                    sample.p95_speed_mps,
                    sample.mean_delay_s,
                    sample.queue_length,
                    sample.active_vehicle_count,
                    sample.active_pedestrian_count,
                    sample.vehicles_completed,
                    sample.pedestrians_completed,
                )
                for sample in samples
            ],
        )
        if vehicle_states:
            conn.cursor().executemany(
                """
                INSERT INTO vehicle_states (
                    observed_at, run_id, intersection_id, vehicle_id,
                    simulation_time_s, x, y, longitude, latitude,
                    speed_mps, acceleration_mps2, road_id, lane_id
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    (
                        started_at + timedelta(seconds=state.simulation_time_s),
                        run_id,
                        intersection_id,
                        state.vehicle_id,
                        state.simulation_time_s,
                        state.x,
                        state.y,
                        state.longitude,
                        state.latitude,
                        state.speed_mps,
                        state.acceleration_mps2,
                        state.road_id,
                        state.lane_id,
                    )
                    for state in vehicle_states
                ],
            )
        if ttc_events:
            conn.cursor().executemany(
                """
                INSERT INTO ttc_events (
                    observed_at, event_id, run_id, intersection_id,
                    simulation_time_s, time_to_collision_s,
                    actor_a_id, actor_a_type, actor_b_id, actor_b_type,
                    x, y, relative_speed_mps, metadata
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                          %s, %s, %s, %s)
                """,
                [
                    (
                        started_at + timedelta(seconds=event.simulation_time_s),
                        uuid.uuid4(),
                        run_id,
                        intersection_id,
                        event.simulation_time_s,
                        event.time_to_collision_s,
                        event.actor_a_id,
                        event.actor_a_type,
                        event.actor_b_id,
                        event.actor_b_type,
                        event.x,
                        event.y,
                        event.relative_speed_mps,
                        Jsonb(event.metadata(safety_config.ttc_thresholds_s)),
                    )
                    for event in ttc_events
                ],
            )
        conn.execute(
            """
            UPDATE simulation_runs
            SET status = 'completed', completed_at = %s,
                simulation_config = simulation_config || %s
            WHERE run_id = %s
            """,
            (completed_at, Jsonb({"metrics": metrics.to_dict()}), run_id),
        )


def mark_failed(conn: Any, run_id: uuid.UUID) -> None:
    conn.execute(
        "UPDATE simulation_runs SET status = 'failed', completed_at = now() WHERE run_id = %s",
        (run_id,),
    )
    conn.commit()
