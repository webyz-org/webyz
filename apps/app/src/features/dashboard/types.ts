export type ViewType = "list" | "map";

export type Column<T> = {
  key: string;
  label: string;
  render: (item: T) => React.ReactNode;
  className?: string;
};

export type TabConfig<T> = {
  key: string;
  label: string;
  data: T[];
  isLoading: boolean;
  modalData?: T[];
  modalLoading?: boolean;
  viewType?: ViewType;
  columns: Column<T>[];
  modalTitle: string;
  renderCard?: (data: T[], isLoading: boolean) => React.ReactNode;
  /** When set, rows are clickable (used to apply drill-down filters). */
  onRowClick?: (item: T) => void;
  /** Request failed; the card shows a retry affordance when onRetry is set. */
  error?: boolean;
  onRetry?: () => void;
};

/** One row of any breakdown. Detailed rows carry the extra metrics. */
export type BreakdownRow = {
  name: string;
  visitors: number;
  percentage: number;
  visits?: number;
  pageviews?: number;
  bounce_rate?: number;
  visit_duration?: number;
};

export type TopStat = {
  name: string;
  value: number;
  comparison_value: number;
  change: number;
  graph_metric: string;
};

export type TopStatsResponse = {
  from: number;
  to: number;
  comparing_from: number;
  comparing_to: number;
  top_stats: TopStat[] | null;
};

/** Requests the ingest bot filters refused in the period, by reason. */
export type FilteredTrafficResponse = {
  from: number;
  to: number;
  total: number;
  reasons: Record<string, number>;
};

export type MainGraphResponse = {
  labels: string[];
  plot: number[];
  metric: string;
  interval: string;
  timezone: string;
};

export type RealtimeResponse = {
  current_visitors: number;
  labels: string[];
  plot: number[];
  top_pages: { name: string; visitors: number }[];
};

export type Conversion = {
  id: string;
  name: string;
  event_name: string | null;
  page_path: string | null;
  visitors: number;
  completions: number;
  conversion_rate: number;
};

export type CustomEvent = {
  name: string;
  visitors: number;
  completions: number;
  percentage: number;
};

/** One property key of a custom event, or one value of a key. */
export type CustomEventProperty = {
  name: string;
  visitors: number;
  events: number;
  percentage: number;
};

// ─── Outbound links ──────────────────────────────────────────────────────────

/** Which link event a report reads: outbound clicks or file downloads. */
export type LinkEventKind = "outbound" | "download";

/** Grouping of the link report: destination host, full URL, source page, or file extension. */
export type OutboundGroup = "domain" | "url" | "page" | "type";

export type OutboundRow = {
  name: string;
  visitors: number;
  clicks: number;
  /** Share of visitors who clicked out at all; drives the bar. */
  percentage: number;
  /** Share of every visitor in the period: the click-through rate. */
  conversion_rate: number;
};

export type OutboundTotals = {
  clicks: number;
  visitors: number;
  destinations: number;
  /** Distinct destination URLs: the files, for downloads. */
  urls: number;
  pages: number;
  clicks_per_visitor: number;
  /** Visitors who clicked out over all visitors, in percent. */
  click_rate: number;
  site_visitors: number;
};

export type OutboundSummary = OutboundTotals & {
  from: number;
  to: number;
  comparing_from: number;
  comparing_to: number;
  previous: OutboundTotals;
};

export type OutboundTimeseries = {
  labels: string[];
  clicks: number[];
  visitors: number[];
  interval: string;
  timezone: string;
};

// ─── Journeys ────────────────────────────────────────────────────────────────

export type JourneyMetric = "users" | "sessions";

export type JourneyNode = {
  path: string;
  volume: number;
  /** volume / starting-point volume * 100, one decimal. */
  percentage: number;
};

export type JourneyStep = {
  depth: number;
  paths: JourneyNode[];
  /** Custom events on the previous column's dominant path, or null. */
  events: { path: string; items: { name: string; volume: number }[] } | null;
};

export type JourneysResponse = {
  metric: JourneyMetric;
  depth: number;
  startingPoints: { path: string; volume: number }[];
  startingPoint: { path: string; volume: number } | null;
  steps: JourneyStep[];
};

/**
 * Breakdown dimensions, keyed by the URL segment the API exposes.
 * Adding one here is enough for the generic hook to serve it.
 */
export const DIMENSIONS = {
  pages: "top-pages",
  entries: "entries",
  exits: "exits",

  browsers: "browsers",
  browser_versions: "browser-versions",
  os: "os",
  os_versions: "os-versions",
  devices: "device-types",
  screen_sizes: "screen-sizes",
  languages: "languages",

  channel: "channel",
  source: "source",
  utm_source: "utm-source",
  utm_medium: "utm-medium",
  utm_campaign: "utm-campaign",
  utm_content: "utm-content",
  utm_term: "utm-term",

  countries: "countries",
  regions: "regions",
  cities: "cities",
} as const;

export type DimensionKey = keyof typeof DIMENSIONS;
