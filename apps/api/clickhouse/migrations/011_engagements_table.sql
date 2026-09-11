-- Per-report detail behind the session's engaged_seconds and scroll_depth
-- (see 010): one row per engagement report, for time on page and scroll
-- depth per page.
CREATE TABLE IF NOT EXISTS webyz_analytics.engagements (
  `website_id` String,
  `session_id` String,
  `user_id` String,
  `timestamp` DateTime('UTC') CODEC(Delta(4), LZ4),
  `url_path` String CODEC(ZSTD(3)),
  `engaged_ms` UInt32,
  `scroll_depth` UInt8
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (website_id, timestamp, session_id)
SETTINGS index_granularity = 8192;
