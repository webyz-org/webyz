import { AppContext } from "../../lib/context.js";
import {
  BreakdownFilters,
  SessionDimension,
  pageBreakdown,
  sessionBreakdown,
} from "../../db/clickhouse/breakdown.js";
import { calculatePercentage } from "./helpers.js";

export type BreakdownInput = {
  websiteId: string;
  dimension: SessionDimension | "page";
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

  const rows =
    input.dimension === "page"
      ? await pageBreakdown(clickhouse, {
          websiteId: input.websiteId,
          from: input.from,
          to: input.to,
          pagination,
          filters: input.filters,
        })
      : await sessionBreakdown(clickhouse, {
          websiteId: input.websiteId,
          from: input.from,
          to: input.to,
          dimension: input.dimension,
          pagination,
          filters: input.filters,
          pagePath: input.pagePath,
          conversion: input.conversion,
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
