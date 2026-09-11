import type { AppContext } from "../../lib/context.js";
import type { SessionDimension } from "../../db/clickhouse/breakdown.js";
import type { AnalyticsFilters } from "../../db/clickhouse/filters.js";
import { timeseriesQuery, type Interval } from "../../db/clickhouse/timeseries.js";
import { getBreakdown } from "./breakdown.service.js";
import { bucketLabels, validateInterval } from "./main-graph.service.js";

/**
 * URL segment -> session dimension, shared by the breakdown routes and the
 * export so the two can never disagree about what "browsers" means. Paths are
 * kept stable because the dashboard already calls them.
 */
export const BREAKDOWN_SEGMENTS: Record<string, SessionDimension | "page"> = {
  "top-pages": "page",
  entries: "entry_page",
  exits: "exit_page",

  browsers: "browser",
  "browser-versions": "browser_version",
  os: "os",
  "os-versions": "os_version",
  "device-types": "device",
  "screen-sizes": "screen",
  languages: "language",

  channel: "channel",
  source: "source",
  "utm-source": "utm_source",
  "utm-medium": "utm_medium",
  "utm-campaign": "utm_campaign",
  "utm-content": "utm_content",
  "utm-term": "utm_term",

  countries: "country",
  regions: "region",
  cities: "city",
};

/**
 * What can be exported. Every breakdown the dashboard shows, plus the
 * timeseries behind the main graph. One dataset per file: the dashboard
 * offers them as a menu, and a script can fetch exactly what it needs.
 */
export const EXPORT_DATASETS = ["timeseries", ...Object.keys(BREAKDOWN_SEGMENTS)] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

export const isExportDataset = (value: string): value is ExportDataset =>
  (EXPORT_DATASETS as readonly string[]).includes(value);

/**
 * Cap on rows per file. A breakdown past this is not something anyone reads
 * in a spreadsheet; the API's paginated endpoints exist for programmatic use.
 */
export const EXPORT_ROW_LIMIT = 10_000;

const TIMESERIES_METRICS = ["visitors", "visits", "pageviews", "bounce_rate", "visit_duration"] as const;

export type ExportTable = {
  columns: string[];
  rows: Array<Array<string | number | null>>;
};

export type ExportInput = {
  websiteId: string;
  dataset: ExportDataset;
  from: number;
  to: number;
  timezone: string;
  filters?: AnalyticsFilters;
};

/** Daily buckets unless the window is short enough for hourly ones to be readable. */
const exportInterval = (from: number, to: number): Interval =>
  validateInterval(to - from <= 60 * 60 * 24 * 2 ? "hour" : "day", from, to);

export const getExportTable = async (ctx: AppContext, input: ExportInput): Promise<ExportTable> => {
  if (input.dataset === "timeseries") return timeseriesTable(ctx, input);

  const dimension = BREAKDOWN_SEGMENTS[input.dataset];
  const data = await getBreakdown(ctx, {
    websiteId: input.websiteId,
    dimension,
    from: input.from,
    to: input.to,
    limit: EXPORT_ROW_LIMIT,
    page: 1,
    detailed: true,
    filters: input.filters,
  });

  return {
    columns: [dimension, "visitors", "visits", "pageviews", "bounce_rate", "visit_duration"],
    rows: data.results.map((r) => [
      r.name,
      r.visitors,
      r.visits ?? null,
      r.pageviews ?? null,
      r.bounce_rate ?? null,
      r.visit_duration ?? null,
    ]),
  };
};

/**
 * One row per bucket with every graph metric as a column. The graph endpoint
 * returns one metric at a time; here the five series are fetched together and
 * joined on the bucket label the labels helper generates, so gaps read as 0
 * just as they do on the chart.
 */
const timeseriesTable = async ({ clickhouse }: AppContext, input: ExportInput): Promise<ExportTable> => {
  const interval = exportInterval(input.from, input.to);
  const labels = bucketLabels(input.from, input.to, interval, input.timezone);

  const series = await Promise.all(
    TIMESERIES_METRICS.map(async (metric) => {
      const rows = await timeseriesQuery(clickhouse, {
        websiteId: input.websiteId,
        from: input.from,
        to: input.to,
        metric,
        interval,
        timezone: input.timezone,
        filters: input.filters,
      });
      return new Map(rows.map((r) => [r.t, Number(r.value)]));
    }),
  );

  return {
    columns: ["date", ...TIMESERIES_METRICS],
    rows: labels.map((label) => [label, ...series.map((byBucket) => byBucket.get(label) ?? 0)]),
  };
};
