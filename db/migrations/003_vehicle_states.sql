CREATE TABLE IF NOT EXISTS vehicle_states (
    observed_at TIMESTAMPTZ NOT NULL,
    run_id UUID NOT NULL REFERENCES simulation_runs(run_id) ON DELETE CASCADE,
    intersection_id TEXT NOT NULL REFERENCES intersections(intersection_id),
    vehicle_id TEXT NOT NULL,
    simulation_time_s DOUBLE PRECISION NOT NULL,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION,
    latitude DOUBLE PRECISION,
    speed_mps DOUBLE PRECISION NOT NULL,
    acceleration_mps2 DOUBLE PRECISION NOT NULL,
    road_id TEXT,
    lane_id TEXT,
    PRIMARY KEY (observed_at, run_id, vehicle_id)
);

SELECT create_hypertable(
    'vehicle_states',
    by_range('observed_at', INTERVAL '1 day'),
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS vehicle_states_run_time_idx
    ON vehicle_states (run_id, simulation_time_s);

CREATE INDEX IF NOT EXISTS vehicle_states_run_vehicle_idx
    ON vehicle_states (run_id, vehicle_id, simulation_time_s);
