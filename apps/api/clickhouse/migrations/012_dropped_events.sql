-- One row per request the ingest filters refused, with the reason and no
-- address or user agent. This is what the dashboard's "filtered traffic"
-- figure reads, so the bot filters are visible instead of being taken on
-- trust. Kept 13 months, the longest plan retention plus a margin.
CREATE TABLE IF NOT EXISTS webyz_analytics.dropped_events (
  `website_id` String,
  `timestamp` DateTime('UTC') CODEC(Delta(4), LZ4),
  `reason` LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (website_id, timestamp)
TTL timestamp + INTERVAL 400 DAY
SETTINGS index_granularity = 8192;
