-- Engagement: how long a page was visible and how far it was scrolled, sent
-- by the tracker when a tab is hidden, loses focus or is left. Before this,
-- visit duration was last pageview minus first, so every single-page visit
-- was 0 s and a finished article counted as a bounce with no time on site.
--
-- The session row gains the visible time and the deepest scroll; the per-
-- pageview detail goes to its own table so that neither the events table
-- (billable, counted everywhere) nor its queries change shape.
ALTER TABLE webyz_analytics.sessions
  ADD COLUMN IF NOT EXISTS `engaged_seconds` UInt32 DEFAULT 0 AFTER events,
  ADD COLUMN IF NOT EXISTS `scroll_depth` UInt8 DEFAULT 0 AFTER engaged_seconds;
