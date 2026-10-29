-- Daily aggregates imported from another analytics tool (Google Analytics 4
-- or a Plausible export), merged into the dashboard at read time
-- (core/imports/imported-plan.ts). Imported days never overlap tracked days.
--
-- One row per site, import, local day, report family and combination of that
-- family's attributes, exactly as the source reported them together: a
-- `sources` row carries its channel, source and UTM fields side by side, a
-- `locations` row its country, region and city. Keeping them together is
-- what lets a filter apply to imported data when the filter and the report
-- come from the same family ("source is Google", broken down by campaign),
-- the rule Plausible follows. Attributes outside a row's family are ''.
-- Values are the labels the dashboard renders, so reads compare and group
-- them like tracked rows.
--
-- `visit_duration` and the engagement totals are sums, so averages merge by
-- dividing summed parts. `events` counts events (custom events, link clicks,
-- searches). An import's rows are removed by its id.
CREATE TABLE IF NOT EXISTS webyz_analytics.imported_stats (
  `website_id` String,
  `import_id` String,
  `date` Date,
  `family` LowCardinality(String),

  `channel` LowCardinality(String) DEFAULT '',
  `source` String DEFAULT '' CODEC(ZSTD(3)),
  `utm_source` String DEFAULT '' CODEC(ZSTD(3)),
  `utm_medium` String DEFAULT '' CODEC(ZSTD(3)),
  `utm_campaign` String DEFAULT '' CODEC(ZSTD(3)),
  `utm_content` String DEFAULT '' CODEC(ZSTD(3)),
  `utm_term` String DEFAULT '' CODEC(ZSTD(3)),
  `page` String DEFAULT '' CODEC(ZSTD(3)),
  `hostname` String DEFAULT '' CODEC(ZSTD(3)),
  `title` String DEFAULT '' CODEC(ZSTD(3)),
  `entry_page` String DEFAULT '' CODEC(ZSTD(3)),
  `exit_page` String DEFAULT '' CODEC(ZSTD(3)),
  `country` LowCardinality(String) DEFAULT '',
  `region` String DEFAULT '' CODEC(ZSTD(3)),
  `city` String DEFAULT '' CODEC(ZSTD(3)),
  `device` LowCardinality(String) DEFAULT '',
  `screen` LowCardinality(String) DEFAULT '',
  `browser` LowCardinality(String) DEFAULT '',
  `browser_version` String DEFAULT '' CODEC(ZSTD(3)),
  `os` LowCardinality(String) DEFAULT '',
  `os_version` String DEFAULT '' CODEC(ZSTD(3)),
  `language` LowCardinality(String) DEFAULT '',
  `event` String DEFAULT '' CODEC(ZSTD(3)),
  `outbound_url` String DEFAULT '' CODEC(ZSTD(3)),
  `outbound_domain` String DEFAULT '' CODEC(ZSTD(3)),
  `download` String DEFAULT '' CODEC(ZSTD(3)),
  `search_term` String DEFAULT '' CODEC(ZSTD(3)),
  `prop_key` String DEFAULT '' CODEC(ZSTD(3)),
  `prop_value` String DEFAULT '' CODEC(ZSTD(3)),

  `visitors` UInt64 DEFAULT 0,
  `visits` UInt64 DEFAULT 0,
  `pageviews` UInt64 DEFAULT 0,
  `bounces` UInt64 DEFAULT 0,
  `visit_duration` UInt64 DEFAULT 0,
  `events` UInt64 DEFAULT 0,
  `scroll_depth` UInt64 DEFAULT 0,
  `scroll_depth_visits` UInt64 DEFAULT 0,
  `time_on_page` UInt64 DEFAULT 0,
  `time_on_page_visits` UInt64 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (website_id, family, date)
SETTINGS index_granularity = 8192;
