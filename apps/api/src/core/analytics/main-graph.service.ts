import { AppContext } from "../../lib/context.js";
import { AnalyticsFilters } from "../../db/clickhouse/filters.js";
import {
  Interval,
  SeriesComponents,
  timeseriesComponentsQuery,
  timeseriesQuery,
} from "../../db/clickhouse/timeseries.js";
import { importedBucketable, importedTimeseriesQuery } from "../../db/clickhouse/imported.js";
import { readFor, type ImportedContext } from "../imports/imported-window.js";
import type { ImportedRead } from "../../db/clickhouse/imported.js";

/** Keep bucket counts sane: widen the interval when the range is too long. */
export const validateInterval = (
  interval: Interval,
  from: number,
  to: number,
): Interval => {
  const diff = to - from;

  if (interval === "minute" && diff > 60 * 60 * 6) return "hour";
  if (interval === "hour" && diff > 60 * 60 * 24 * 14) return "day";
  if (interval === "day" && diff > 60 * 60 * 24 * 365) return "month";

  return interval;
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Bucket labels are generated from the same wall-clock instants ClickHouse
 * bucketed by, using an explicit offset lookup so labels and data align. The
 * previous version bucketed in Asia/Kolkata but generated labels in UTC, so
 * every point was offset and the graph silently mismatched its own axis.
 */
const zonedParts = (epochSeconds: number, timezone: string) => {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = fmt.formatToParts(new Date(epochSeconds * 1000));
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour") === "24" ? "0" : get("hour")),
    minute: Number(get("minute")),
  };
};

export const bucketLabels = (
  from: number,
  to: number,
  interval: Interval,
  timezone: string,
): string[] => {
  const labels: string[] = [];
  const start = zonedParts(from, timezone);

  // Walk in the site's local calendar using UTC arithmetic on a proxy date,
  // which keeps month and day steps correct across DST boundaries.
  let cursor = Date.UTC(
    start.year,
    start.month - 1,
    interval === "month" ? 1 : start.day,
    interval === "minute" || interval === "hour" ? start.hour : 0,
    interval === "minute" ? start.minute : 0,
  );
  // Labels must name the buckets ClickHouse fills: toStartOfWeek (Sunday,
  // mode 0) and toStartOfMonth. Starting at the window's first day instead
  // gave week and month labels no bucket ever matched, so a weekly graph of
  // any period not starting on a Sunday was all zeros.
  if (interval === "week") cursor -= new Date(cursor).getUTCDay() * 86_400_000;

  const end = (() => {
    const e = zonedParts(to, timezone);
    return Date.UTC(
      e.year,
      e.month - 1,
      e.day,
      interval === "minute" || interval === "hour" ? e.hour : 0,
      interval === "minute" ? e.minute : 0,
    );
  })();

  let guard = 0;
  while (cursor < end && guard++ < 10_000) {
    const d = new Date(cursor);
    labels.push(
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
        `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`,
    );

    switch (interval) {
      case "minute":
        cursor += 60_000;
        break;
      case "hour":
        cursor += 3_600_000;
        break;
      case "day":
        cursor += 86_400_000;
        break;
      case "week":
        cursor += 7 * 86_400_000;
        break;
      case "month": {
        const d2 = new Date(cursor);
        cursor = Date.UTC(d2.getUTCFullYear(), d2.getUTCMonth() + 1, 1);
        break;
      }
    }
  }

  return labels;
};

/** One metric from summed parts, matching METRIC_SQL in timeseries.ts. */
export const metricFromComponents = (
  metric: string,
  c: Omit<SeriesComponents, "t"> & { rate_visits?: number },
): number => {
  const perVisit = (n: number) => (c.visits ? n / c.visits : 0);
  // Bounces and seconds divide by the visits that carry them (imported page
  // and event rows add visits without either).
  const rateVisits = c.rate_visits ?? c.visits;
  const perRateVisit = (n: number) => (rateVisits ? n / rateVisits : 0);
  switch (metric) {
    case "visitors":
      return c.visitors;
    case "pageviews":
      return c.pageviews;
    case "views_per_visit":
      return Math.round(perVisit(c.pageviews) * 100) / 100;
    case "bounce_rate":
      return Math.round(perRateVisit(c.bounces) * 100 * 100) / 100;
    case "visit_duration":
      return Math.round(perRateVisit(c.visit_duration));
    default:
      return c.visits;
  }
};

/**
 * Tracked and imported parts per bucket, added. Imported data is daily, so
 * this only runs for day, week and month buckets; at hour resolution the
 * imported days have nothing to place and are left out.
 */
const mergedSeries = async (
  clickhouse: AppContext["clickhouse"],
  input: {
    websiteId: string;
    from: number;
    to: number;
    metric: string;
    interval: Interval;
    timezone: string;
    filters?: AnalyticsFilters;
  },
  read: ImportedRead,
) => {
  const [native, imported] = await Promise.all([
    timeseriesComponentsQuery(clickhouse, input),
    importedTimeseriesQuery(clickhouse, { websiteId: input.websiteId, read, interval: input.interval }),
  ]);
  type Parts = Omit<SeriesComponents, "t"> & { rate_visits: number };
  const byBucket = new Map<string, Parts>();
  const add = (t: string, row: Omit<SeriesComponents, "t">, rateVisits: number) => {
    const acc = byBucket.get(t) ?? { visitors: 0, visits: 0, pageviews: 0, bounces: 0, visit_duration: 0, rate_visits: 0 };
    acc.visitors += row.visitors;
    acc.visits += row.visits;
    acc.pageviews += row.pageviews;
    acc.bounces += row.bounces;
    acc.visit_duration += row.visit_duration;
    acc.rate_visits += rateVisits;
    byBucket.set(t, acc);
  };
  for (const row of native) add(row.t, row, row.visits);
  for (const row of imported) add(row.t, row, row.rate_visits);
  return [...byBucket].map(([t, c]) => ({ t, value: metricFromComponents(input.metric, c) }));
};

export const getMainGraph = async (
  { clickhouse }: AppContext,
  input: {
    websiteId: string;
    from: number;
    to: number;
    metric: string;
    interval: Interval;
    timezone: string;
    filters?: AnalyticsFilters;
    imported?: ImportedContext | null;
  },
) => {
  const interval = validateInterval(input.interval, input.from, input.to);
  const read = readFor(input.imported, null);
  const query = {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    metric: input.metric,
    interval,
    timezone: input.timezone,
    filters: input.filters,
  };

  const rows =
    read && importedBucketable(interval)
      ? await mergedSeries(clickhouse, query, read)
      : await timeseriesQuery(clickhouse, query);

  const byBucket = new Map(rows.map((r) => [r.t, Number(r.value)]));
  const labels = bucketLabels(input.from, input.to, interval, input.timezone);

  return {
    labels,
    plot: labels.map((l) => byBucket.get(l) ?? 0),
    metric: input.metric,
    interval,
    timezone: input.timezone,
  };
};
