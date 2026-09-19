CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS intersections (
    intersection_id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    signal_operation_type TEXT,
    longitude DOUBLE PRECISION NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    coverage_score DOUBLE PRECISION NOT NULL,
    safety_priority_score DOUBLE PRECISION NOT NULL,
    selection_reason TEXT NOT NULL,
    source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_imports (
    source_id TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_count BIGINT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (source_id, source_sha256)
);

CREATE TABLE IF NOT EXISTS road_design_snapshots (
    intersection_id TEXT NOT NULL REFERENCES intersections(intersection_id),
    source_version TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    signal_operation_type TEXT,
    crosswalk_count INTEGER NOT NULL,
    high_injury_network BOOLEAN NOT NULL,
    high_injury_segment_count INTEGER NOT NULL,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (intersection_id, source_version)
);

CREATE TABLE IF NOT EXISTS crash_events (
    crash_id BIGINT NOT NULL,
    intersection_id TEXT NOT NULL REFERENCES intersections(intersection_id),
    crash_year SMALLINT NOT NULL,
    crash_month SMALLINT,
    day_of_week SMALLINT,
    hour_of_day SMALLINT,
    longitude DOUBLE PRECISION,
    latitude DOUBLE PRECISION,
    street_name TEXT,
    speed_limit SMALLINT,
    fatalities SMALLINT NOT NULL DEFAULT 0,
    injuries SMALLINT NOT NULL DEFAULT 0,
    serious_injuries SMALLINT NOT NULL DEFAULT 0,
    pedestrian_count SMALLINT NOT NULL DEFAULT 0,
    bicycle_count SMALLINT NOT NULL DEFAULT 0,
    vulnerable_road_user_count SMALLINT NOT NULL DEFAULT 0,
    vehicle_count SMALLINT NOT NULL DEFAULT 0,
    intersection_related BOOLEAN,
    signalized_intersection BOOLEAN,
    speeding_related BOOLEAN,
    collision_type SMALLINT,
    weather_code TEXT,
    road_condition_code TEXT,
    illumination_code TEXT,
    source_id TEXT NOT NULL,
    PRIMARY KEY (crash_id, intersection_id),
    CHECK (crash_month IS NULL OR crash_month BETWEEN 1 AND 12)
);

CREATE INDEX IF NOT EXISTS crash_events_intersection_year_idx
    ON crash_events (intersection_id, crash_year DESC, crash_month DESC);
CREATE INDEX IF NOT EXISTS crash_events_vru_idx
    ON crash_events (intersection_id, vulnerable_road_user_count)
    WHERE vulnerable_road_user_count > 0;

CREATE TABLE IF NOT EXISTS intervention_studies (
    study_id TEXT NOT NULL,
    location_id TEXT NOT NULL,
    street TEXT NOT NULL,
    from_street TEXT,
    to_street TEXT,
    intervention_type TEXT NOT NULL,
    location_description TEXT,
    source_url TEXT NOT NULL,
    before_period TEXT,
    after_period TEXT,
    PRIMARY KEY (study_id, location_id)
);

CREATE TABLE IF NOT EXISTS intervention_measurements (
    study_id TEXT NOT NULL,
    location_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    unit TEXT NOT NULL,
    before_value DOUBLE PRECISION NOT NULL,
    after_value DOUBLE PRECISION NOT NULL,
    absolute_change DOUBLE PRECISION NOT NULL,
    relative_change DOUBLE PRECISION,
    PRIMARY KEY (study_id, location_id, metric),
    FOREIGN KEY (study_id, location_id)
        REFERENCES intervention_studies(study_id, location_id)
);

CREATE TABLE IF NOT EXISTS simulation_runs (
    run_id UUID PRIMARY KEY,
    intersection_id TEXT NOT NULL REFERENCES intersections(intersection_id),
    scenario_name TEXT NOT NULL,
    random_seed BIGINT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    intervention_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    simulation_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS traffic_observations (
    observed_at TIMESTAMPTZ NOT NULL,
    intersection_id TEXT NOT NULL REFERENCES intersections(intersection_id),
    source_record_id TEXT NOT NULL,
    observation_end TIMESTAMPTZ,
    counter_type TEXT,
    average_daily_car_traffic DOUBLE PRECISION,
    average_daily_bike_traffic DOUBLE PRECISION,
    median_speed_mph DOUBLE PRECISION,
    p85_speed_mph DOUBLE PRECISION,
    p95_speed_mph DOUBLE PRECISION,
    percent_over_limit DOUBLE PRECISION,
    speed_limit_mph DOUBLE PRECISION,
    max_speed_mph DOUBLE PRECISION,
    longitude DOUBLE PRECISION NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (observed_at, intersection_id, source_record_id)
);

SELECT create_hypertable(
    'traffic_observations',
    by_range('observed_at', INTERVAL '1 year'),
    if_not_exists => TRUE
);

CREATE TABLE IF NOT EXISTS simulation_samples (
    simulated_at TIMESTAMPTZ NOT NULL,
    run_id UUID NOT NULL REFERENCES simulation_runs(run_id) ON DELETE CASCADE,
    intersection_id TEXT NOT NULL REFERENCES intersections(intersection_id),
    simulation_time_s DOUBLE PRECISION NOT NULL,
    mean_speed_mps DOUBLE PRECISION,
    p95_speed_mps DOUBLE PRECISION,
    mean_delay_s DOUBLE PRECISION,
    mean_queue_length DOUBLE PRECISION,
    active_vehicle_count INTEGER,
    active_pedestrian_count INTEGER,
    vehicles_completed INTEGER NOT NULL DEFAULT 0,
    pedestrians_completed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (simulated_at, run_id, simulation_time_s)
);

SELECT create_hypertable(
    'simulation_samples',
    by_range('simulated_at', INTERVAL '1 day'),
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS simulation_samples_run_time_idx
    ON simulation_samples (run_id, simulation_time_s);

CREATE TABLE IF NOT EXISTS ttc_events (
    observed_at TIMESTAMPTZ NOT NULL,
    event_id UUID NOT NULL,
    run_id UUID NOT NULL REFERENCES simulation_runs(run_id) ON DELETE CASCADE,
    intersection_id TEXT NOT NULL REFERENCES intersections(intersection_id),
    simulation_time_s DOUBLE PRECISION NOT NULL,
    time_to_collision_s DOUBLE PRECISION NOT NULL CHECK (time_to_collision_s >= 0),
    actor_a_id TEXT,
    actor_a_type TEXT,
    actor_b_id TEXT,
    actor_b_type TEXT,
    x DOUBLE PRECISION,
    y DOUBLE PRECISION,
    relative_speed_mps DOUBLE PRECISION,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (observed_at, event_id)
);

SELECT create_hypertable(
    'ttc_events',
    by_range('observed_at', INTERVAL '1 day'),
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS ttc_events_run_ttc_idx
    ON ttc_events (run_id, time_to_collision_s, simulation_time_s);

