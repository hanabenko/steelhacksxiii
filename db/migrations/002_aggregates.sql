CREATE MATERIALIZED VIEW IF NOT EXISTS simulation_metrics_1s
WITH (timescaledb.continuous) AS
SELECT
    time_bucket(INTERVAL '1 second', simulated_at) AS bucket,
    run_id,
    intersection_id,
    avg(mean_speed_mps) AS mean_speed_mps,
    max(p95_speed_mps) AS p95_speed_mps,
    avg(mean_delay_s) AS mean_delay_s,
    avg(mean_queue_length) AS mean_queue_length,
    max(active_vehicle_count) AS peak_active_vehicles,
    max(active_pedestrian_count) AS peak_active_pedestrians,
    sum(vehicles_completed) AS vehicles_completed,
    sum(pedestrians_completed) AS pedestrians_completed
FROM simulation_samples
GROUP BY bucket, run_id, intersection_id
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS ttc_events_1s
WITH (timescaledb.continuous) AS
SELECT
    time_bucket(INTERVAL '1 second', observed_at) AS bucket,
    run_id,
    intersection_id,
    min(time_to_collision_s) AS minimum_ttc_s,
    count(*) AS conflict_count,
    count(*) FILTER (WHERE time_to_collision_s < 1.5) AS severe_conflict_count,
    count(*) FILTER (WHERE time_to_collision_s >= 1.5 AND time_to_collision_s < 3.0)
        AS moderate_conflict_count,
    avg(relative_speed_mps) AS mean_relative_speed_mps
FROM ttc_events
GROUP BY bucket, run_id, intersection_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'simulation_metrics_1s',
    start_offset => INTERVAL '7 days',
    end_offset => INTERVAL '1 second',
    schedule_interval => INTERVAL '1 minute',
    if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy(
    'ttc_events_1s',
    start_offset => INTERVAL '7 days',
    end_offset => INTERVAL '1 second',
    schedule_interval => INTERVAL '1 minute',
    if_not_exists => TRUE
);

CREATE OR REPLACE VIEW intersection_crash_history AS
SELECT
    intersection_id,
    crash_year,
    crash_month,
    count(*) AS crash_count,
    sum(fatalities) AS fatalities,
    sum(injuries) AS injuries,
    sum(serious_injuries) AS serious_injuries,
    count(*) FILTER (WHERE vulnerable_road_user_count > 0) AS vru_crash_count,
    count(*) FILTER (WHERE speeding_related) AS speeding_related_crash_count
FROM crash_events
GROUP BY intersection_id, crash_year, crash_month;

CREATE OR REPLACE VIEW simulation_run_summary AS
WITH sample_summary AS (
    SELECT
        run_id,
        min(mean_speed_mps) AS minimum_mean_speed_mps,
        avg(mean_speed_mps) AS mean_speed_mps,
        max(p95_speed_mps) AS peak_p95_speed_mps,
        avg(mean_delay_s) AS mean_delay_s,
        max(mean_queue_length) AS peak_queue_length,
        sum(vehicles_completed) AS vehicles_completed
    FROM simulation_samples
    GROUP BY run_id
),
ttc_summary AS (
    SELECT
        run_id,
        count(*) AS ttc_event_count,
        count(*) FILTER (WHERE time_to_collision_s < 1.5) AS severe_ttc_event_count,
        min(time_to_collision_s) AS minimum_ttc_s
    FROM ttc_events
    GROUP BY run_id
)
SELECT
    r.run_id,
    r.intersection_id,
    r.scenario_name,
    r.random_seed,
    r.status,
    s.minimum_mean_speed_mps,
    s.mean_speed_mps,
    s.peak_p95_speed_mps,
    s.mean_delay_s,
    s.peak_queue_length,
    s.vehicles_completed,
    coalesce(t.ttc_event_count, 0) AS ttc_event_count,
    coalesce(t.severe_ttc_event_count, 0) AS severe_ttc_event_count,
    t.minimum_ttc_s
FROM simulation_runs r
LEFT JOIN sample_summary s ON s.run_id = r.run_id
LEFT JOIN ttc_summary t ON t.run_id = r.run_id;
