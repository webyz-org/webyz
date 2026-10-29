import { ClickHouseClient } from "@clickhouse/client";

import { shortVersionLabel } from "../../utils/version.js";
import { predicate, type AnalyticsFilters } from "./filters.js";
import type { Interval } from "./timeseries.js";

/**
 * `imported_stats` (migration 013): daily aggregates imported from another
 * tool, one row per day, report family and combination of that family's
 * attributes. Imported days never overlap tracked days (an import ends the
 * day before the first tracked session), so merging is addition.
 *
 * Every read is shaped by a plan (core/imports/imported-plan.ts): the family
 * whose rows answer the question and the filters to apply to them. Local
 * dates bound it: `from` inclusive, `to` exclusive.
 */

/** A plan as the query layer needs it (core/imports/imported-plan.ts builds it). */
export type ImportedQueryPlan = {
  family: string;
  filters: AnalyticsFilters;
  /** Adds no bounces or visit seconds, so it must not dilute those rates. */
  rateNeutral: boolean;
};

/** Local dates to read: `from` inclusive, `to` exclusive. */
export type ImportedDates = { from: string; to: string };

/**
 * One planned read: which days, which rows, and from which imports. Only
 * completed imports are read (Plausible does the same), so rows of an upload
 * still in progress, or left behind if deleting an import's rows failed,
 * never reach the dashboard.
 */
export type ImportedRead = { dates: ImportedDates; plan: ImportedQueryPlan; importIds: string[] };

export type ImportedInsertRow = Record<string, string | number | undefined> & {
  website_id: string;
  import_id: string;
  date: string;
  family: string;
};

export const insertImportedRows = async (clickhouse: ClickHouseClient, rows: ImportedInsertRow[]) => {
  if (!rows.length) return;
  await clickhouse.insert({
    table: "webyz_analytics.imported_stats",
    values: rows,
    format: "JSONEachRow",
  });
};

/**
 * Remove one import's rows. Synchronous, so a retried import never writes on
 * top of a half-deleted earlier attempt.
 */
export const deleteImportedRows = async (clickhouse: ClickHouseClient, importId: string) => {
  await clickhouse.command({
    query: "ALTER TABLE webyz_analytics.imported_stats DELETE WHERE import_id = {importId:String}",
    query_params: { importId },
    clickhouse_settings: { mutations_sync: "1" },
  });
};

/** The local date of the site's first tracked session, or null before any. */
export const firstTrackedDate = async (
  clickhouse: ClickHouseClient,
  websiteId: string,
  timezone: string,
): Promise<string | null> => {
  const result = await clickhouse.query({
    query: `
      SELECT toString(toDate(min(start_time), {timezone:String})) AS day, count() AS n
      FROM webyz_analytics.sessions
      WHERE website_id = {websiteId:String}
    `,
    query_params: { websiteId, timezone },
    format: "JSONEachRow",
  });
  const [row] = await result.json<{ day: string; n: string }>();
  return row && Number(row.n) > 0 ? row.day : null;
};

/** Columns a filter key reads; identical names (the plan guarantees the family). */
const VERSION_KEYS = new Set(["browser_version", "os_version"]);

/**
 * WHERE for a planned read, binding its parameters under `prefix` so two
 * reads can share one query. The caller binds `websiteId`.
 */
export const importedWhere = (read: ImportedRead, params: Record<string, unknown>, prefix = "imp"): string => {
  params[`${prefix}Family`] = read.plan.family;
  params[`${prefix}From`] = read.dates.from;
  params[`${prefix}To`] = read.dates.to;
  params[`${prefix}Ids`] = read.importIds;
  const clauses = [
    "website_id = {websiteId:String}",
    `import_id IN ({${prefix}Ids:Array(String)})`,
    `family = {${prefix}Family:String}`,
    `date >= {${prefix}From:Date}`,
    `date <  {${prefix}To:Date}`,
  ];
  for (const [key, condition] of Object.entries(read.plan.filters)) {
    if (!condition) continue;
    const param = `${prefix}_f_${key}`;
    params[param] =
      VERSION_KEYS.has(key) && (condition.op === "is" || condition.op === "is_not")
        ? shortVersionLabel(condition.value)
        : condition.value;
    clauses.push(predicate(key, condition.op, param));
  }
  return clauses.join("\n        AND ");
};

/**
 * Visits that count towards bounce rate and visit duration. Qualified, since
 * the same SELECT aliases `sum(visits) AS visits` and ClickHouse would read a
 * bare `visits` as that alias (an aggregate inside an aggregate).
 */
export const rateVisitsExpr = (plan: ImportedQueryPlan) => (plan.rateNeutral ? "0" : "imported_stats.visits");

export type ImportedTotals = {
  visitors: number;
  visits: number;
  pageviews: number;
  bounces: number;
  visit_duration: number;
  /** Denominator for bounce rate and duration (0 for rate-neutral families). */
  rate_visits: number;
};

const ZERO: ImportedTotals = { visitors: 0, visits: 0, pageviews: 0, bounces: 0, visit_duration: 0, rate_visits: 0 };

const TOTAL_COLUMNS = (plan: ImportedQueryPlan) => `
        toUInt64(sum(visitors)) AS visitors,
        toUInt64(sum(visits)) AS visits,
        toUInt64(sum(pageviews)) AS pageviews,
        toUInt64(sum(bounces)) AS bounces,
        toUInt64(sum(visit_duration)) AS visit_duration,
        toUInt64(sum(${rateVisitsExpr(plan)})) AS rate_visits`;

const toTotals = (r: Record<string, string> | undefined): ImportedTotals =>
  r
    ? {
        visitors: Number(r.visitors ?? 0),
        visits: Number(r.visits ?? 0),
        pageviews: Number(r.pageviews ?? 0),
        bounces: Number(r.bounces ?? 0),
        visit_duration: Number(r.visit_duration ?? 0),
        rate_visits: Number(r.rate_visits ?? 0),
      }
    : { ...ZERO };

/** Totals for each planned read (zeros for a null one). */
export const importedTotalsQuery = async (
  clickhouse: ClickHouseClient,
  websiteId: string,
  reads: Array<ImportedRead | null>,
): Promise<ImportedTotals[]> =>
  Promise.all(
    reads.map(async (read) => {
      if (!read) return { ...ZERO };
      const query_params: Record<string, unknown> = { websiteId };
      const result = await clickhouse.query({
        query: `SELECT ${TOTAL_COLUMNS(read.plan)} FROM webyz_analytics.imported_stats WHERE ${importedWhere(read, query_params)}`,
        query_params,
        format: "JSONEachRow",
      });
      const [row] = await result.json<Record<string, string>>();
      return toTotals(row);
    }),
  );

/** Day-or-coarser bucket of a Date column, labelled like the native series. */
const DATE_BUCKET: Partial<Record<Interval, string>> = {
  day: "date",
  week: "toStartOfWeek(date)",
  month: "toStartOfMonth(date)",
};

export const importedBucketable = (interval: Interval) => interval in DATE_BUCKET;

/** The bucket expression over `date` for an interval, or null at hour resolution. */
export const importedDateBucket = (interval: Interval): string | null => DATE_BUCKET[interval] ?? null;

export type ImportedBucket = ImportedTotals & { t: string; events: number };

/**
 * Planned totals per day, week or month bucket. Imported data is daily, so
 * there is nothing to place in hour or minute buckets and callers do not ask.
 * `nonEmpty` restricts to rows with a value in that column (link clicks).
 */
export const importedTimeseriesQuery = async (
  clickhouse: ClickHouseClient,
  input: { websiteId: string; read: ImportedRead; interval: Interval; nonEmpty?: string },
): Promise<ImportedBucket[]> => {
  const bucket = DATE_BUCKET[input.interval];
  if (!bucket) return [];
  const query_params: Record<string, unknown> = { websiteId: input.websiteId };
  const where = importedWhere(input.read, query_params);
  const result = await clickhouse.query({
    query: `
      SELECT
        formatDateTime(toDateTime(${bucket}), '%Y-%m-%d %H:%i:00') AS t,
        ${TOTAL_COLUMNS(input.read.plan)},
        toUInt64(sum(events)) AS events
      FROM webyz_analytics.imported_stats
      WHERE ${where}${input.nonEmpty ? ` AND ${input.nonEmpty} != ''` : ""}
      GROUP BY t
      ORDER BY t
    `,
    query_params,
    format: "JSONEachRow",
  });
  const rows = await result.json<Record<string, string>>();
  return rows.map((r) => ({ ...toTotals(r), t: r.t, events: Number(r.events ?? 0) }));
};

/**
 * SQL for a merged breakdown's imported half: rows grouped by `nameExpr`
 * (a column, or an allowlisted expression over one), with the parts the
 * tracked half produces. Binds into `params`.
 */
export const importedGroupSql = (
  read: ImportedRead,
  nameExpr: string,
  params: Record<string, unknown>,
  prefix = "imp",
): string => `
      SELECT
        ${nameExpr} AS name,
        toUInt64(sum(visitors)) AS visitors,
        toUInt64(sum(visits)) AS visits,
        toUInt64(sum(pageviews)) AS pageviews,
        toUInt64(sum(bounces)) AS bounces,
        toUInt64(sum(visit_duration)) AS duration,
        toUInt64(sum(${rateVisitsExpr(read.plan)})) AS rate_visits
      FROM webyz_analytics.imported_stats
      WHERE ${importedWhere(read, params, prefix)} AND ${nameExpr} != ''
      GROUP BY name`;

/**
 * Imported visitors behind a breakdown's percentages: the site total when
 * nothing is filtered (a page or event row would count a visitor once per
 * page or event), else the filtered family's rows.
 */
export const importedVisitorsSql = (read: ImportedRead, params: Record<string, unknown>, prefix = "impTotal"): string => {
  const totalRead: ImportedRead = Object.keys(read.plan.filters).length
    ? read
    : { dates: read.dates, importIds: read.importIds, plan: { family: "visitors", filters: {}, rateNeutral: false } };
  return `(SELECT sum(visitors) FROM webyz_analytics.imported_stats WHERE ${importedWhere(totalRead, params, prefix)})`;
};

export type ImportedGroup = {
  name: string;
  visitors: number;
  visits: number;
  pageviews: number;
  events: number;
  scroll_depth: number;
  scroll_depth_visits: number;
  time_on_page: number;
  time_on_page_visits: number;
};

/**
 * Planned rows summed per `nameExpr` value, optionally only some values.
 * `nameExpr` is a column or allowlisted SQL from the caller, never input.
 */
export const importedGroupsQuery = async (
  clickhouse: ClickHouseClient,
  input: { websiteId: string; read: ImportedRead; nameExpr: string; names?: string[] },
): Promise<ImportedGroup[]> => {
  if (input.names && !input.names.length) return [];
  const query_params: Record<string, unknown> = { websiteId: input.websiteId };
  let namesClause = "";
  if (input.names) {
    query_params.impNames = input.names;
    namesClause = ` AND ${input.nameExpr} IN ({impNames:Array(String)})`;
  }
  const result = await clickhouse.query({
    query: `
      SELECT
        ${input.nameExpr} AS label,
        toUInt64(sum(visitors)) AS visitors,
        toUInt64(sum(visits)) AS visits,
        toUInt64(sum(pageviews)) AS pageviews,
        toUInt64(sum(events)) AS events,
        toUInt64(sum(scroll_depth)) AS scroll_depth,
        toUInt64(sum(scroll_depth_visits)) AS scroll_depth_visits,
        toUInt64(sum(time_on_page)) AS time_on_page,
        toUInt64(sum(time_on_page_visits)) AS time_on_page_visits
      FROM webyz_analytics.imported_stats
      WHERE ${importedWhere(input.read, query_params)}${namesClause}
      GROUP BY label
      HAVING label != ''
    `,
    query_params,
    format: "JSONEachRow",
  });
  const rows = await result.json<Record<string, string>>();
  return rows.map((r) => ({
    name: r.label,
    visitors: Number(r.visitors),
    visits: Number(r.visits),
    pageviews: Number(r.pageviews),
    events: Number(r.events),
    scroll_depth: Number(r.scroll_depth),
    scroll_depth_visits: Number(r.scroll_depth_visits),
    time_on_page: Number(r.time_on_page),
    time_on_page_visits: Number(r.time_on_page_visits),
  }));
};
