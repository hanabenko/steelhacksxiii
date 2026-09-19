SELECT
    scenario_name,
    count(*) AS monte_carlo_runs,
    avg(mean_speed_mps) AS mean_speed_mps,
    avg(mean_delay_s) AS mean_delay_s,
    avg(vehicles_completed) AS mean_vehicles_completed,
    avg(ttc_event_count) AS mean_ttc_events,
    avg(severe_ttc_event_count) AS mean_severe_ttc_events,
    avg(minimum_ttc_s) AS mean_minimum_ttc_s
FROM simulation_run_summary
WHERE intersection_id = %(intersection_id)s
  AND status = 'completed'
GROUP BY scenario_name
ORDER BY scenario_name;

