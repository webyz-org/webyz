/** Periods the API's resolvePeriod understands, with dashboard labels. */
export const PERIODS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_24_hours", label: "Last 24 hours" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_28_days", label: "Last 28 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "this_month", label: "Month to Date" },
  { value: "last_month", label: "Last month" },
  { value: "last_91_days", label: "Last 91 days" },
  { value: "this_year", label: "Year to Date" },
  { value: "last_12_months", label: "Last 12 months" },
  { value: "all_time", label: "All time" },
  { value: "custom", label: "Custom Range" },
] as const;

export type Period = (typeof PERIODS)[number]["value"];

export const DEFAULT_PERIOD: Period = "last_7_days";

/**
 * The period menu, grouped like the picker renders it. Shortcut keys work
 * anywhere on a page with the picker (Plausible's bindings, minus its
 * compare mode). "realtime" is a navigation entry, not a period.
 */
export const PERIOD_MENU: Array<
  Array<{ value: Period | "realtime"; label: string; key: string }>
> = [
  [
    { value: "today", label: "Today", key: "D" },
    { value: "yesterday", label: "Yesterday", key: "E" },
    { value: "realtime", label: "Realtime", key: "R" },
  ],
  [
    { value: "last_24_hours", label: "Last 24 Hours", key: "H" },
    { value: "last_7_days", label: "Last 7 Days", key: "W" },
    { value: "last_28_days", label: "Last 28 Days", key: "F" },
    { value: "last_91_days", label: "Last 91 Days", key: "N" },
  ],
  [
    { value: "this_month", label: "Month to Date", key: "M" },
    { value: "last_month", label: "Last Month", key: "P" },
  ],
  [
    { value: "this_year", label: "Year to Date", key: "Y" },
    { value: "last_12_months", label: "Last 12 Months", key: "L" },
  ],
  [
    { value: "all_time", label: "All time", key: "A" },
    { value: "custom", label: "Custom Range", key: "C" },
  ],
];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-09-02" -> "Sep 2, 2026" (parsed as plain fields, never as a Date). */
const formatDay = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

/** Label for the picker button; a custom period shows its actual range. */
export const periodLabel = (value: string, from?: string, to?: string) => {
  if (value === "custom" && from && to) {
    return from === to ? formatDay(from) : `${formatDay(from)} - ${formatDay(to)}`;
  }
  return PERIODS.find((p) => p.value === value)?.label ?? value;
};

/**
 * Graph granularity that suits the period. The API clamps anything too fine,
 * this just avoids asking for 8760 hourly buckets on a year view.
 */
export const intervalForPeriod = (period: string) => {
  switch (period) {
    case "today":
    case "yesterday":
    case "last_24_hours":
      return "hour";
    case "last_7_days":
    case "last_28_days":
    case "last_30_days":
    case "this_month":
    case "last_month":
    case "custom":
      return "day";
    default:
      return "month";
  }
};

export type GraphInterval = "hour" | "day" | "week" | "month";

export const INTERVAL_LABELS: Record<GraphInterval, string> = {
  hour: "Hourly",
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
};

/**
 * Granularities that make sense for a period, coarsest last. The default is
 * the first entry, which matches intervalForPeriod; the API still widens
 * anything that would produce too many buckets.
 */
export const intervalOptionsFor = (period: string): GraphInterval[] => {
  switch (period) {
    case "today":
    case "yesterday":
    case "last_24_hours":
      return ["hour"];
    case "last_7_days":
    case "last_28_days":
    case "last_30_days":
    case "this_month":
    case "last_month":
      return ["day", "week"];
    case "last_91_days":
    case "custom":
      return ["day", "week", "month"];
    default:
      return ["month", "week"];
  }
};
