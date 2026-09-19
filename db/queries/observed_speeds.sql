SELECT
    i.name,
    t.observed_at,
    t.average_daily_car_traffic,
    t.median_speed_mph,
    t.p85_speed_mph,
    t.p95_speed_mph,
    t.percent_over_limit,
    t.speed_limit_mph
FROM traffic_observations t
JOIN intersections i USING (intersection_id)
WHERE t.intersection_id = %(intersection_id)s
ORDER BY t.observed_at;

