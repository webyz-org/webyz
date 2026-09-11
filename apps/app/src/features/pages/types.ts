/** Sort keys the /pages endpoint accepts. */
export type PagesSortKey =
  | "views"
  | "sessions"
  | "visitors"
  | "bounce_rate"
  | "duration"
  | "trend";

export type PagesSortOrder = "asc" | "desc";

/** Path vs full-URL display. Presentation only; the page identity is the path. */
export type PageDisplayMode = "path" | "url";

export type PageEntry = {
  path: string;
  title: string;
  views: number;
  sessions: number;
  visitors: number;
  bounce_rate: number;
  avg_duration: number;
  prev_views: number;
  /** Percent change vs the previous period; meaningless when prev_views is 0. */
  change: number;
  /** Pageviews per trend bucket, aligned with trend_labels. */
  spark: number[];
};

export type PagesSummary = {
  pages: number;
  pageviews: number;
  sessions: number;
  bounce_rate: number;
  avg_duration: number;
  top_page: string | null;
};

export type PagesResponse = {
  summary: PagesSummary;
  trend_labels: string[];
  interval: string;
  results: PageEntry[];
  meta: {
    page: number;
    limit: number;
    total_items: number;
    has_more: boolean;
  };
};

export type BreakdownEntry = {
  name: string;
  visitors: number;
  percentage: number;
};

export type PageDetailResponse = {
  path: string;
  title: string;
  stats: {
    views: number;
    prev_views: number;
    change: number;
    sessions: number;
    visitors: number;
    bounce_rate: number;
    avg_duration: number;
    entry_sessions: number;
    exit_sessions: number;
    exit_rate: number;
  };
  trend: { labels: string[]; plot: number[]; interval: string };
  sources: BreakdownEntry[];
  devices: BreakdownEntry[];
  countries: BreakdownEntry[];
  events: Array<{ name: string; total: number; visitors: number }>;
};
