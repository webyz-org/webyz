export type GscStatus = {
  /** False when the server has no Google OAuth credentials configured. */
  configured: boolean;
  connected: boolean;
  property: string | null;
  google_email: string | null;
};

export type GscProperty = {
  /** "sc-domain:example.com" or "https://example.com/". */
  siteUrl: string;
  permissionLevel: string;
};

export type GscDimension = "query" | "page" | "country" | "device";
export type GscSortKey = "clicks" | "impressions" | "ctr" | "position";

export type GscTotals = {
  clicks: number;
  impressions: number;
  /** Percent, already 0-100. */
  ctr: number;
  /** Average position, 1 is best. */
  position: number;
};

export type GscRow = GscTotals & { key: string };

export type GscSearchResponse = {
  property: string;
  start_date: string;
  end_date: string;
  /** True when Google returned its row cap; the table shows the top slice. */
  truncated: boolean;
  summary: GscTotals;
  previous: GscTotals;
  results: GscRow[];
  meta: {
    page: number;
    limit: number;
    total_items: number;
    has_more: boolean;
  };
};
