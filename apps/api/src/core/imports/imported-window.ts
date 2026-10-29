import { AppContext } from "../../lib/context.js";
import type { AnalyticsFilters } from "../../db/clickhouse/filters.js";
import type { ImportedRead } from "../../db/clickhouse/imported.js";
import { planImported } from "./imported-plan.js";
import { addDays, localDate } from "./dates.js";

/**
 * Which local days of a site carry imported data, and whether a given
 * dashboard request should include them. Every analytics read that merges
 * imported rows goes through `resolveImportedAccess` and `applyImported`, so the rule is in
 * one place:
 *
 * - only completed imports count;
 * - only the part of the request's window that overlaps the imported days;
 * - under a filter only when the filter and the report come from one import
 *   family (imported-plan.ts): "source is Google, by campaign" works, while
 *   "country is India, by browser" cannot be read from aggregates and the
 *   response says so (`meta.imported = "excluded_filters"`) rather than
 *   silently showing a smaller number;
 * - `with_imported=false` turns it off, for comparing tracked data alone.
 */

/** Inclusive local dates, and the completed imports whose rows may be read. */
export type ImportedWindow = { start: string; end: string; importIds: string[] };

/** Local dates to read: `from` inclusive, `to` exclusive. */
export type ImportedScope = { from: string; to: string };

export type ImportedStatus = "included" | "excluded_filters" | "off";

const CACHE_TTL_SECONDS = 300;
const cacheKey = (siteId: string) => `imports:window:${siteId}`;

export const getImportedWindow = async (ctx: AppContext, siteId: string): Promise<ImportedWindow | null> => {
  const cached = await ctx.redis.get(cacheKey(siteId)).catch(() => null);
  if (cached) return cached === "none" ? null : (JSON.parse(cached) as ImportedWindow);

  // Imports never overlap (imports.service assertImportSlot) and never reach
  // a tracked day, so one span from the first imported day to the last is
  // safe: days in a gap between imports simply have no imported rows.
  const done = await ctx.prisma.siteImport.findMany({
    where: { websiteId: siteId, status: "COMPLETED" },
    select: { id: true, startDate: true, endDate: true },
  });
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const window: ImportedWindow | null = done.length
    ? {
        start: done.map((r) => day(r.startDate)).sort()[0],
        end: done.map((r) => day(r.endDate)).sort().reverse()[0],
        importIds: done.map((r) => r.id),
      }
    : null;
  await ctx.redis.setex(cacheKey(siteId), CACHE_TTL_SECONDS, window ? JSON.stringify(window) : "none").catch(() => null);
  return window;
};

export const invalidateImportedWindow = async (ctx: AppContext, siteId: string) => {
  await ctx.redis.del(cacheKey(siteId)).catch(() => null);
};

/** The imported days inside a Unix-seconds window ([from, to)), or null. */
export const importedScope = (
  window: ImportedWindow | null,
  from: number,
  to: number,
  timezone: string,
): ImportedScope | null => {
  if (!window || to <= from) return null;
  const fromDay = localDate(from, timezone);
  // `to` is exclusive, normally local midnight, so its date is the first day out.
  const toDay = localDate(to - 1, timezone);
  const scopeFrom = fromDay > window.start ? fromDay : window.start;
  const lastDay = toDay < window.end ? toDay : window.end;
  if (scopeFrom > lastDay) return null;
  return { from: scopeFrom, to: addDays(lastDay, 1) };
};

/** What a request may do with imported data, before any window is applied. */
export type ImportedAccess = {
  window: ImportedWindow | null;
  /** `with_imported=false`. */
  disabled: boolean;
};

export const resolveImportedAccess = async (
  ctx: AppContext,
  input: { siteId: string; disabled: boolean },
): Promise<ImportedAccess> => ({
  window: await getImportedWindow(ctx, input.siteId),
  disabled: input.disabled,
});

/**
 * Imported days a request window may merge, with the request's filters, for
 * each report to plan against (`readFor`). Null when no imported day is in
 * the window or merging is turned off.
 */
export type ImportedContext = { dates: ImportedScope; filters: AnalyticsFilters; importIds: string[] };

export type ImportedApplied = { context: ImportedContext | null; off: boolean };

export const applyImported = (
  access: ImportedAccess,
  from: number,
  to: number,
  timezone: string,
  filters: AnalyticsFilters,
): ImportedApplied => {
  const dates = importedScope(access.window, from, to, timezone);
  if (!dates) return { context: null, off: false };
  if (access.disabled) return { context: null, off: true };
  return { context: { dates, filters, importIds: access.window!.importIds }, off: false };
};

/**
 * The planned read for one report (`dimension`, null for totals and the
 * graph), or null when imported data cannot answer it under the filters.
 * `filters` overrides the request's (the outbound report leaves its own
 * link filters out of its denominator).
 */
export const readFor = (
  context: ImportedContext | null | undefined,
  dimension: string | null,
  filters?: AnalyticsFilters,
): ImportedRead | null => {
  if (!context) return null;
  const plan = planImported(dimension, filters ?? context.filters);
  return plan ? { dates: context.dates, plan, importIds: context.importIds } : null;
};

/** What `meta.imported` reports for one report: nothing when no imported day is in range. */
export const importedStatus = (applied: ImportedApplied, dimension: string | null): ImportedStatus | undefined => {
  if (applied.off) return "off";
  if (!applied.context) return undefined;
  return readFor(applied.context, dimension) ? "included" : "excluded_filters";
};
