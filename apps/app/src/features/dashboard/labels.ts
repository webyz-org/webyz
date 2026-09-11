import type { GraphMetric } from "./hooks/useDashboard";

export const METRIC_LABELS: Record<GraphMetric, string> = {
  visitors: "Unique visitors",
  visits: "Total visits",
  pageviews: "Pageviews",
  views_per_visit: "Views per visit",
  bounce_rate: "Bounce rate",
  visit_duration: "Visit duration",
};

export const SHORT_METRIC_LABELS: Record<GraphMetric, string> = {
  visitors: "Visitors",
  visits: "Visits",
  pageviews: "Pageviews",
  views_per_visit: "Views / visit",
  bounce_rate: "Bounce rate",
  visit_duration: "Duration",
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Bucket labels arrive as "YYYY-MM-DD HH:mm:00" already expressed in the
 * site's timezone, so they are formatted as plain strings. Parsing them as
 * dates would re-apply the browser's offset and shift every point.
 */
const parts = (label: string) => {
  const [datePart, timePart] = label.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  return { year, month, day, hhmm: (timePart ?? "00:00:00").slice(0, 5) };
};

/** Short axis tick: "14:00", "25 Aug", "Aug 2026". */
export const formatAxisLabel = (label: string, interval: string) => {
  const { year, month, day, hhmm } = parts(label);
  switch (interval) {
    case "minute":
    case "hour":
      return hhmm;
    case "month":
      return `${MONTHS[month - 1]} ${year}`;
    default:
      return `${day} ${MONTHS[month - 1]}`;
  }
};

/** Tooltip / insight title: "Aug 25", "Aug 25, 14:00", "Aug 2026". */
export const formatBucketTitle = (label: string, interval: string) => {
  const { year, month, day, hhmm } = parts(label);
  switch (interval) {
    case "minute":
    case "hour":
      return `${MONTHS[month - 1]} ${day}, ${hhmm}`;
    case "month":
      return `${MONTHS[month - 1]} ${year}`;
    case "week":
      return `Week of ${MONTHS[month - 1]} ${day}`;
    default:
      return `${MONTHS[month - 1]} ${day}`;
  }
};
