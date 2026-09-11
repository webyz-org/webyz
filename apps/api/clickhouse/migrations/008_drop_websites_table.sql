-- The websites table was created by 005 and nothing ever wrote to it: the
-- site's domain and timezone live in Postgres, and every ClickHouse table is
-- keyed by website_id. Only the purge helper touched it, to delete rows that
-- were never there. Dropping it removes a table that could only mislead.
DROP TABLE IF EXISTS webyz_analytics.websites;
