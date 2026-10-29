import { AppContext } from "../../lib/context.js";
import {
  BreakdownFilters,
  SessionDimension,
  pageBreakdown,
  searchTermBreakdown,
  sessionBreakdown,
} from "../../db/clickhouse/breakdown.js";
import { calculatePercentage } from "./helpers.js";
import { readFor, type ImportedContext } from "../imports/imported-window.js";

/** Session dimensions plus the three read from pageviews. */
export type BreakdownDimension = SessionDimension | "page" | "title" | "search_term";

export type BreakdownInput = {
  websiteId: string;
  dimension: BreakdownDimension;
  from: number;
  to: number;
  limit: number;
  page: number;
  detailed: boolean;
  filters?: BreakdownFilters;
  /** Restrict to sessions that viewed this page (session dimensions only). */
  pagePath?: string;
  /** Restrict to sessions that completed a goal (session dimensions only). */
  conversion?: { eventName?: string | null; pagePath?: string | null };
  /** Imported days this request may merge (core/imports/imported-window.ts). */
  imported?: ImportedContext | null;
};

export type BreakdownResult = {
  results: Array<{
    name: string;
    visitors: number;
    percentage: number;
    visits?: number;
    pageviews?: number;
    bounce_rate?: number;
    visit_duration?: number;
  }>;
  meta: {
    page: number;
    limit: number;
    total_visitors: number;
    total_items: number;
    has_more: boolean;
  };
};

/**
 * One breakdown for every dimension the dashboard shows.
 *
 * `percentage` is always visitors over the same filtered visitor total returned
 * by the query, so a breakdown's percentages are comparable and never exceed
 * 100. The previous per-dimension code divided visitor counts by a session
 * count, which is why percentages summed past 100.
 */
export const getBreakdown = async (
  { clickhouse }: AppContext,
  input: BreakdownInput,
): Promise<BreakdownResult> => {
  const offset = (input.page - 1) * input.limit;
  const pagination = { limit: input.limit, offset };

  // Dimensions are named like imported_stats columns, so the dimension is
  // what the plan reads; a page or conversion restriction has no imported twin.
  const imported =
    input.pagePath || input.conversion ? null : readFor(input.imported, input.dimension, input.filters ?? {});
  const pageviewInput = {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    pagination,
    filters: input.filters,
    imported,
  };
  const rows =
    input.dimension === "page" || input.dimension === "title"
      ? await pageBreakdown(clickhouse, {
          ...pageviewInput,
          column: input.dimension === "title" ? "page_title" : "url_path",
        })
      : input.dimension === "search_term"
        ? await searchTermBreakdown(clickhouse, pageviewInput)
        : await sessionBreakdown(clickhouse, {
          websiteId: input.websiteId,
          from: input.from,
          to: input.to,
          dimension: input.dimension,
          pagination,
          filters: input.filters,
          pagePath: input.pagePath,
          conversion: input.conversion,
          imported,
        });

  const totalVisitors = rows[0]?.total_visitors ?? 0;
  const totalItems = rows[0]?.dimension_count ?? 0;

  return {
    results: rows.map((row) => ({
      name: row.name,
      visitors: row.visitors,
      percentage: calculatePercentage(row.visitors, totalVisitors),
      ...(input.detailed && {
        visits: "visits" in row ? Number(row.visits) : undefined,
        pageviews: row.pageviews,
        bounce_rate: row.bounce_rate,
        visit_duration: row.visit_duration,
      }),
    })),
    meta: {
      page: input.page,
      limit: input.limit,
      total_visitors: totalVisitors,
      total_items: totalItems,
      has_more: offset + rows.length < totalItems,
    },
  };
};
