CREATE MATERIALIZED VIEW webyz_analytics.hourly_aggregates_mv
TO webyz_analytics.hourly_aggregates
AS
SELECT
  website_id,
  
  toStartOfHour(start_time) AS hour,

  countState() as visits,
  sumState(toUInt64(page_views)) as pageviews,
  sumState(toUInt64(if(page_views = 1, 1, 0))) as bounces,
  sumState(toUInt64(duration_seconds)) as total_duration,

  uniqCombinedState(user_id) as visitors
FROM webyz_analytics.sessions
GROUP BY website_id, hour;
