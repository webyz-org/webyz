import type { AnalyticsFilters } from "../../db/clickhouse/filters.js";

export type TopStatsInput = {
  websiteId: string;
  from: number;
  to: number;
  compareFrom: number;
  compareTo: number;
  filters?: AnalyticsFilters;
};
