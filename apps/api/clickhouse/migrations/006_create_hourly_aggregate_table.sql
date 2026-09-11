CREATE TABLE webyz_analytics.hourly_aggregates (
  `website_id` String,
  `hour` DateTime('UTC'),

  `visits` AggregateFunction(count),
  `pageviews` AggregateFunction(sum, UInt64),
  `bounces` AggregateFunction(sum, UInt64),
  `total_duration` AggregateFunction(sum, UInt64),

  `visitors` AggregateFunction(uniqCombined, String)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (website_id, hour)
SETTINGS index_granularity = 8192;
