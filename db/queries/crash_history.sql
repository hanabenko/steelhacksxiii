SELECT
    i.name,
    h.crash_year,
    h.crash_month,
    h.crash_count,
    h.fatalities,
    h.injuries,
    h.serious_injuries,
    h.vru_crash_count,
    h.speeding_related_crash_count
FROM intersection_crash_history h
JOIN intersections i USING (intersection_id)
WHERE h.intersection_id = %(intersection_id)s
ORDER BY h.crash_year, h.crash_month;

