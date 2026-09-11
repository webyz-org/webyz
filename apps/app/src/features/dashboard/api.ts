import { api, get, getPaged, type Paged } from "../../lib/axios";
import {
  DIMENSIONS,
  type BreakdownRow,
  type Conversion,
  type CustomEvent,
  type CustomEventProperty,
  type DimensionKey,
  type FilteredTrafficResponse,
  type JourneyMetric,
  type JourneysResponse,
  type MainGraphResponse,
  type RealtimeResponse,
  type TopStatsResponse,
} from "./types";

/**
 * Every call is scoped to a site id and a period supplied by the caller.
 * Both used to be hardcoded here (one dev site id, period always "today"),
 * so the dashboard showed the same fixed data whatever you opened.
 */
export type AnalyticsScope = {
  siteId: string;
  period: string;
  from?: string;
  to?: string;
  /** Drill-down filters; sent as `f.<key>` params on every scoped call. */
  filters?: Record<string, string>;
};

const scopeParams = (scope: AnalyticsScope) => ({
  period: scope.period,
  ...(scope.from ? { from: scope.from } : {}),
  ...(scope.to ? { to: scope.to } : {}),
  ...Object.fromEntries(
    Object.entries(scope.filters ?? {}).map(([key, value]) => [
      `f.${key}`,
      value,
    ]),
  ),
});

/**
 * Datasets the API can export, in the order the menu shows them. Keys are the
 * API's `dataset` values (the same URL segments as the breakdown endpoints).
 */
export const EXPORT_GROUPS: { label: string; items: { key: string; label: string }[] }[] = [
  { label: "Overview", items: [{ key: "timeseries", label: "Visitors over time" }] },
  {
    label: "Pages",
    items: [
      { key: "top-pages", label: "Top pages" },
      { key: "entries", label: "Entry pages" },
      { key: "exits", label: "Exit pages" },
    ],
  },
  {
    label: "Acquisition",
    items: [
      { key: "channel", label: "Channels" },
      { key: "source", label: "Sources" },
      { key: "utm-source", label: "UTM sources" },
      { key: "utm-medium", label: "UTM mediums" },
      { key: "utm-campaign", label: "UTM campaigns" },
      { key: "utm-content", label: "UTM content" },
      { key: "utm-term", label: "UTM terms" },
    ],
  },
  {
    label: "Technology",
    items: [
      { key: "browsers", label: "Browsers" },
      { key: "browser-versions", label: "Browser versions" },
      { key: "os", label: "Operating systems" },
      { key: "os-versions", label: "OS versions" },
      { key: "device-types", label: "Device types" },
      { key: "screen-sizes", label: "Screen sizes" },
      { key: "languages", label: "Languages" },
    ],
  },
  {
    label: "Geography",
    items: [
      { key: "countries", label: "Countries" },
      { key: "regions", label: "Regions" },
      { key: "cities", label: "Cities" },
    ],
  },
];

/**
 * Fetch one dataset as CSV and hand it to the browser as a download. Fetched
 * through axios rather than a plain link so the session cookie, the period and
 * the filters travel exactly as for every other call, and a 403 or 500 comes
 * back as an error the page can show instead of a JSON body in a new tab.
 */
export const downloadExport = async (scope: AnalyticsScope, dataset: string): Promise<void> => {
  const res = await api.get<Blob>(`/${scope.siteId}/export`, {
    params: { ...scopeParams(scope), dataset },
    responseType: "blob",
  });

  const disposition = String(res.headers["content-disposition"] ?? "");
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${dataset}.csv`;

  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const getTopStats = (scope: AnalyticsScope) =>
  get<TopStatsResponse>(`/${scope.siteId}/top-stats`, scopeParams(scope));

export const getMainGraph = (
  scope: AnalyticsScope,
  metric: string,
  interval: string,
) =>
  get<MainGraphResponse>(`/${scope.siteId}/main-graph`, {
    ...scopeParams(scope),
    metric,
    interval,
  });

export const getBreakdown = (
  scope: AnalyticsScope,
  dimension: DimensionKey,
  options: { detailed?: boolean; limit?: number } = {},
): Promise<Paged<BreakdownRow[]>> =>
  getPaged<BreakdownRow[]>(`/${scope.siteId}/${DIMENSIONS[dimension]}`, {
    ...scopeParams(scope),
    detailed: options.detailed ? "true" : "false",
    ...(options.limit ? { limit: options.limit } : {}),
  });

export const getJourneys = (
  scope: AnalyticsScope,
  options: { metric: JourneyMetric; depth: number; startingPath?: string },
) =>
  get<JourneysResponse>(`/${scope.siteId}/journeys`, {
    ...scopeParams(scope),
    metric: options.metric,
    depth: options.depth,
    ...(options.startingPath ? { startingPath: options.startingPath } : {}),
  });

export const getRealtime = (siteId: string) =>
  get<RealtimeResponse>(`/${siteId}/realtime`);

export const getConversions = (scope: AnalyticsScope) =>
  get<Conversion[]>(`/${scope.siteId}/conversions`, scopeParams(scope));

export const getCustomEvents = (scope: AnalyticsScope) =>
  get<CustomEvent[]>(`/${scope.siteId}/custom-events`, scopeParams(scope));

/** Property keys of a custom event, or the values of one key when `key` is set. */
export const getCustomEventProperties = (
  scope: AnalyticsScope,
  eventName: string,
  key?: string,
) =>
  get<CustomEventProperty[]>(`/${scope.siteId}/custom-events/properties`, {
    ...scopeParams(scope),
    event: eventName,
    ...(key ? { key } : {}),
    limit: 100,
  });

/** Filtered (dropped) requests for the period. Not affected by drill-down filters. */
export const getFilteredTraffic = (scope: AnalyticsScope) =>
  get<FilteredTrafficResponse>(`/${scope.siteId}/filtered-traffic`, {
    period: scope.period,
    ...(scope.from ? { from: scope.from } : {}),
    ...(scope.to ? { to: scope.to } : {}),
  });
