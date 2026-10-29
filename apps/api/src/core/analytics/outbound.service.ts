import type { AppContext } from "../../lib/context.js";
import type { AnalyticsFilters, LinkEventKind } from "../../db/clickhouse/filters.js";
import { totalVisitorsQuery } from "../../db/clickhouse/goals.js";
import {
  outboundBreakdownQuery,
  outboundTimeseriesQuery,
  outboundTotalsQuery,
  type OutboundGroup,
} from "../../db/clickhouse/outbound.js";
import { BUCKET_FN, type Interval } from "../../db/clickhouse/timeseries.js";
import { importedTimeseriesQuery, importedTotalsQuery } from "../../db/clickhouse/imported.js";
import { importedLinkBase, importedLinkSource } from "../../db/clickhouse/outbound.js";
import { readFor, type ImportedContext } from "../imports/imported-window.js";
import { calculatePercentage } from "./helpers.js";
import { bucketLabels, validateInterval } from "./main-graph.service.js";

export type OutboundLinksInput = {
  websiteId: string;
  from: number;
  to: number;
  kind: LinkEventKind;
  by: OutboundGroup;
  limit: number;
  page: number;
  filters?: AnalyticsFilters;
  imported?: ImportedContext | null;
};

export type OutboundLinksResult = {
  results: Array<{
    /** The host, the full URL, or the page path, depending on `by`. */
    name: string;
    visitors: number;
    clicks: number;
    /** Share of every visitor who clicked out in the window. */
    percentage: number;
    /** Share of every visitor in the window: the click-through rate. */
    conversion_rate: number;
  }>;
  meta: {
    kind: LinkEventKind;
    by: OutboundGroup;
    page: number;
    limit: number;
    total_visitors: number;
    total_clicks: number;
    site_visitors: number;
    total_items: number;
    has_more: boolean;
  };
};

/**
 * The denominator of every click-through rate: visitors matching the filters
 * except the link filters themselves. Under "outbound domain is github.com"
 * the visitors who clicked are, by definition, every visitor in scope, and
 * 100% tells nobody anything; dividing by the visitors matching the other
 * filters gives "24% of visitors clicked through to github.com". The list
 * and the summary share it, so a row's CTR and the KPI strip never disagree.
 */
const withoutLinkFilters = (filters: AnalyticsFilters | undefined): AnalyticsFilters => {
  const { outbound_domain: _d, outbound_url: _u, download: _f, ...rest } = filters ?? {};
  return rest;
};

/**
 * The outbound links report: where visitors leave to, and from which pages.
 *
 * Two rates come back per row because they answer different questions.
 * `percentage` is over the visitors who clicked out at all, so the bars in a
 * list compare destinations with each other. `conversion_rate` is over every
 * visitor in the window, the same denominator as a goal, so "3% of visitors
 * clicked through to the app store" reads the way a goal does. Both honour
 * the period and the drill-down filters.
 */
export const getOutboundLinks = async (
  { clickhouse }: AppContext,
  input: OutboundLinksInput,
): Promise<OutboundLinksResult> => {
  const offset = (input.page - 1) * input.limit;

  const [rows, nativeSiteVisitors, [importedSite]] = await Promise.all([
    outboundBreakdownQuery(clickhouse, {
      websiteId: input.websiteId,
      from: input.from,
      to: input.to,
      kind: input.kind,
      by: input.by,
      pagination: { limit: input.limit, offset },
      filters: input.filters,
      imported: (() => {
        const source = importedLinkSource(input.kind, input.by);
        return source ? readFor(input.imported, source.column, input.filters ?? {}) : null;
      })(),
    }),
    totalVisitorsQuery(clickhouse, {
      websiteId: input.websiteId,
      from: input.from,
      to: input.to,
      filters: withoutLinkFilters(input.filters),
    }),
    // The click-through denominator leaves the link filters out, as tracked.
    importedTotalsQuery(clickhouse, input.websiteId, [readFor(input.imported, null, withoutLinkFilters(input.filters))]),
  ]);
  const siteVisitors = nativeSiteVisitors + importedSite.visitors;

  const totalVisitors = rows[0]?.total_visitors ?? 0;
  const totalClicks = rows[0]?.total_clicks ?? 0;
  const totalItems = rows[0]?.dimension_count ?? 0;

  return {
    results: rows.map((row) => ({
      name: row.name,
      visitors: row.visitors,
      clicks: row.clicks,
      percentage: calculatePercentage(row.visitors, totalVisitors),
      conversion_rate: calculatePercentage(row.visitors, siteVisitors),
    })),
    meta: {
      kind: input.kind,
      by: input.by,
      page: input.page,
      limit: input.limit,
      total_visitors: totalVisitors,
      total_clicks: totalClicks,
      site_visitors: siteVisitors,
      total_items: totalItems,
      has_more: offset + rows.length < totalItems,
    },
  };
};

// ─── Summary and trend, for the Outbound links page ──────────────────────────

const rate = (value: number, total: number) => calculatePercentage(value, total);

type Totals = {
  clicks: number;
  visitors: number;
  destinations: number;
  urls: number;
  pages: number;
  /** clicks / visitors, one decimal. */
  clicks_per_visitor: number;
  /** Visitors who clicked out over every visitor in the window, in percent. */
  click_rate: number;
  site_visitors: number;
};

const totalsFor = async (
  { clickhouse }: AppContext,
  input: {
    websiteId: string;
    from: number;
    to: number;
    kind: LinkEventKind;
    filters?: AnalyticsFilters;
    imported?: ImportedContext | null;
  },
): Promise<Totals> => {
  if (input.to <= input.from) {
    return { clicks: 0, visitors: 0, destinations: 0, urls: 0, pages: 0, clicks_per_visitor: 0, click_rate: 0, site_visitors: 0 };
  }
  const [totals, nativeSiteVisitors, [importedSite]] = await Promise.all([
    outboundTotalsQuery(clickhouse, {
      ...input,
      imported: readFor(input.imported, importedLinkBase(input.kind), input.filters ?? {}),
    }),
    totalVisitorsQuery(clickhouse, { ...input, filters: withoutLinkFilters(input.filters) }),
    // The click-through denominator leaves the link filters out, as tracked.
    importedTotalsQuery(clickhouse, input.websiteId, [readFor(input.imported, null, withoutLinkFilters(input.filters))]),
  ]);
  const siteVisitors = nativeSiteVisitors + importedSite.visitors;
  return {
    ...totals,
    clicks_per_visitor: totals.visitors ? Number((totals.clicks / totals.visitors).toFixed(1)) : 0,
    click_rate: rate(totals.visitors, siteVisitors),
    site_visitors: siteVisitors,
  };
};

/**
 * The KPI strip of the Outbound links page: this window's totals and the
 * preceding window's, so each number can carry its change. Both honour the
 * drill-down filters, so under a destination filter they describe that
 * destination.
 */
export const getOutboundSummary = async (
  ctx: AppContext,
  input: {
    websiteId: string;
    from: number;
    to: number;
    compareFrom: number;
    compareTo: number;
    kind: LinkEventKind;
    filters?: AnalyticsFilters;
    imported?: { current: ImportedContext | null; comparison: ImportedContext | null };
  },
) => {
  const [current, previous] = await Promise.all([
    totalsFor(ctx, { ...input, imported: input.imported?.current }),
    totalsFor(ctx, {
      websiteId: input.websiteId,
      from: input.compareFrom,
      to: input.compareTo,
      kind: input.kind,
      filters: input.filters,
      imported: input.imported?.comparison,
    }),
  ]);
  return { kind: input.kind, ...current, previous };
};

/** Clicks and clicking visitors per bucket, gaps filled with zero. */
export const getOutboundTimeseries = async (
  { clickhouse }: AppContext,
  input: {
    websiteId: string;
    from: number;
    to: number;
    kind: LinkEventKind;
    interval: Interval;
    timezone: string;
    filters?: AnalyticsFilters;
    imported?: ImportedContext | null;
  },
) => {
  const interval = validateInterval(input.interval, input.from, input.to);
  const labels = bucketLabels(input.from, input.to, interval, input.timezone);
  const [rows, imported] = await Promise.all([
    outboundTimeseriesQuery(clickhouse, {
      websiteId: input.websiteId,
      from: input.from,
      to: input.to,
      kind: input.kind,
      filters: input.filters,
      bucketFn: BUCKET_FN[interval],
      timezone: input.timezone,
    }),
    (() => {
      const base = importedLinkBase(input.kind);
      const read = readFor(input.imported, base, input.filters ?? {});
      return read
        ? importedTimeseriesQuery(clickhouse, { websiteId: input.websiteId, read, interval, nonEmpty: base })
        : Promise.resolve([]);
    })(),
  ]);
  const byBucket = new Map(rows.map((r) => [r.t, { clicks: Number(r.clicks), visitors: Number(r.visitors) }]));
  for (const r of imported) {
    const acc = byBucket.get(r.t) ?? { clicks: 0, visitors: 0 };
    byBucket.set(r.t, { clicks: acc.clicks + r.events, visitors: acc.visitors + r.visitors });
  }
  return {
    labels,
    clicks: labels.map((l) => byBucket.get(l)?.clicks ?? 0),
    visitors: labels.map((l) => byBucket.get(l)?.visitors ?? 0),
    interval,
    timezone: input.timezone,
  };
};
