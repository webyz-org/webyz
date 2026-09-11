ALTER TABLE webyz_analytics.sessions
  ADD COLUMN IF NOT EXISTS `screen` LowCardinality(String) DEFAULT '' AFTER device_brand,
  ADD COLUMN IF NOT EXISTS `language` LowCardinality(String) DEFAULT '' AFTER screen;
