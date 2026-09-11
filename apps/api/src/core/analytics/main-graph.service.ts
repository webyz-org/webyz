import { AppContext } from "../../lib/context.js";
import { AnalyticsFilters } from "../../db/clickhouse/filters.js";
import { Interval, timeseriesQuery } from "../../db/clickhouse/timeseries.js";

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
    start.day,
    interval === "minute" || interval === "hour" ? start.hour : 0,
    interval === "minute" ? start.minute : 0,
  );

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
  },
) => {
  const interval = validateInterval(input.interval, input.from, input.to);

  const rows = await timeseriesQuery(clickhouse, {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    metric: input.metric,
    interval,
    timezone: input.timezone,
    filters: input.filters,
  });

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
