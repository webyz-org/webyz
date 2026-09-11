import { useQueries, useQuery } from "@tanstack/react-query";

import {
  getBreakdown,
  getConversions,
  getCustomEventProperties,
  getCustomEvents,
  getFilteredTraffic,
  getJourneys,
  getMainGraph,
  getRealtime,
  getTopStats,
  type AnalyticsScope,
} from "../api";
import type {
  DimensionKey,
  JourneyMetric,
  MainGraphResponse,
} from "../types";

/** Shared cache key prefix so a site's analytics can be invalidated together. */
const scopeKey = (scope: AnalyticsScope) => [
  "analytics",
  scope.siteId,
  scope.period,
  scope.from ?? null,
  scope.to ?? null,
  scope.filters ?? null,
];

const enabledFor = (scope: AnalyticsScope) => Boolean(scope.siteId);

export const useTopStats = (scope: AnalyticsScope) =>
  useQuery({
    queryKey: [...scopeKey(scope), "top-stats"],
    queryFn: () => getTopStats(scope),
    enabled: enabledFor(scope),
  });

export const useFilteredTraffic = (scope: AnalyticsScope) =>
  useQuery({
    // Keyed without the drill-down filters: drops have no dimensions to filter on.
    queryKey: ["analytics", scope.siteId, scope.period, scope.from ?? null, scope.to ?? null, "filtered-traffic"],
    queryFn: () => getFilteredTraffic(scope),
    enabled: enabledFor(scope),
  });

export const useMainGraph = (
  scope: AnalyticsScope,
  metric: string,
  interval: string,
) =>
  useQuery({
    queryKey: [...scopeKey(scope), "main-graph", metric, interval],
    queryFn: () => getMainGraph(scope, metric, interval),
    enabled: enabledFor(scope),
  });

/** Every metric the graph can plot, in KPI order. */
export const GRAPH_METRICS = [
  "visitors",
  "visits",
  "pageviews",
  "views_per_visit",
  "bounce_rate",
  "visit_duration",
] as const;

export type GraphMetric = (typeof GRAPH_METRICS)[number];

export type MetricSeries = Partial<Record<GraphMetric, MainGraphResponse>>;

/**
 * All six series for the period at once. They feed the KPI sparklines, the
 * multi-metric tooltip and the main chart, so switching the plotted metric is
 * instant and the tooltip can show visitors, visits and pageviews for a
 * bucket without a second request. Cache keys match useMainGraph.
 */
export const useMetricSeries = (scope: AnalyticsScope, interval: string) => {
  const results = useQueries({
    queries: GRAPH_METRICS.map((metric) => ({
      queryKey: [...scopeKey(scope), "main-graph", metric, interval],
      queryFn: () => getMainGraph(scope, metric, interval),
      enabled: enabledFor(scope),
      // Keep the old line on screen while the new range loads; the chart
      // animates between them instead of flashing a skeleton.
      placeholderData: (previous: MainGraphResponse | undefined) => previous,
    })),
  });

  const series: MetricSeries = {};
  GRAPH_METRICS.forEach((metric, i) => {
    const data = results[i].data;
    if (data) series[metric] = data;
  });

  return {
    series,
    isLoading: results.some((r) => r.isLoading),
    isPending: results.some((r) => r.isPending && !r.data),
    isError: results.some((r) => r.isError),
  };
};

/**
 * One hook for every breakdown. `enabled` lets a card skip fetching for tabs
 * that are not visible, and the detailed variant is only fetched when the
 * expanded modal is open.
 */
export const useBreakdown = (
  scope: AnalyticsScope,
  dimension: DimensionKey,
  options: {
    detailed?: boolean;
    limit?: number;
    enabled?: boolean;
  } = {},
) => {
  const { detailed = false, limit, enabled = true } = options;

  return useQuery({
    queryKey: [
      ...scopeKey(scope),
      "breakdown",
      dimension,
      detailed,
      limit ?? null,
    ],
    queryFn: () => getBreakdown(scope, dimension, { detailed, limit }),
    enabled: enabled && enabledFor(scope),
  });
};

export const useJourneys = (
  scope: AnalyticsScope,
  options: { metric: JourneyMetric; depth: number; startingPath?: string },
) =>
  useQuery({
    queryKey: [
      ...scopeKey(scope),
      "journeys",
      options.metric,
      options.depth,
      options.startingPath ?? null,
    ],
    queryFn: () => getJourneys(scope, options),
    enabled: enabledFor(scope),
    // Keep the previous journey on screen while a new root/depth loads, so
    // the layout does not collapse to a skeleton on every click.
    placeholderData: (previous) => previous,
  });

/**
 * Polls while the tab is open; the API window is the last five minutes.
 * `intervalMs` is looser on the website list, which polls one query per row.
 */
export const useRealtime = (siteId?: string, intervalMs = 15_000) =>
  useQuery({
    queryKey: ["realtime", siteId],
    queryFn: () => getRealtime(siteId!),
    enabled: Boolean(siteId),
    refetchInterval: intervalMs,
    staleTime: 0,
  });

export const useConversions = (scope: AnalyticsScope, enabled = true) =>
  useQuery({
    queryKey: [...scopeKey(scope), "conversions"],
    queryFn: () => getConversions(scope),
    enabled: enabled && enabledFor(scope),
  });

export const useCustomEvents = (scope: AnalyticsScope, enabled = true) =>
  useQuery({
    queryKey: [...scopeKey(scope), "custom-events"],
    queryFn: () => getCustomEvents(scope),
    enabled: enabled && enabledFor(scope),
  });

export const useCustomEventProperties = (
  scope: AnalyticsScope,
  eventName: string | undefined,
  key: string | undefined,
  enabled = true,
) =>
  useQuery({
    queryKey: [...scopeKey(scope), "custom-event-properties", eventName ?? null, key ?? null],
    queryFn: () => getCustomEventProperties(scope, eventName!, key),
    enabled: enabled && enabledFor(scope) && Boolean(eventName),
  });
