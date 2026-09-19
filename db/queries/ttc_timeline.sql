SELECT
    bucket,
    minimum_ttc_s,
    conflict_count,
    severe_conflict_count,
    moderate_conflict_count,
    mean_relative_speed_mps
FROM ttc_events_1s
WHERE run_id = %(run_id)s
ORDER BY bucket;

