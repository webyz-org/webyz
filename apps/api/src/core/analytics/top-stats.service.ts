import { topStatsQuery } from "../../db/clickhouse/top-stats.js";
import { importedTotalsQuery } from "../../db/clickhouse/imported.js";
import { AppContext } from "../../lib/context.js";
import { readFor, type ImportedContext } from "../imports/imported-window.js";
import { TopStatsInput } from "./types.js";

export const getTopStats = async (
  { clickhouse }: AppContext,
  input: TopStatsInput & {
    /** Imported days each window may merge (core/imports/imported-window.ts). */
    imported?: { current: ImportedContext | null; comparison: ImportedContext | null };
  },
) => {
  const row = await topStatsQuery(
    clickhouse,
    input.websiteId,
    input.from,
    input.to,
    input.compareFrom,
    input.compareTo,
    input.filters,
  );

  if (!row) return null;

  // Imported days are disjoint from tracked ones, so their totals add.
  // Duration is an average, so it merges through total seconds.
  // Planned for site totals under the request's filters: a filter within one
  // import family ("country is India") reads that family's rows.
  const [impCurr, impPrev] = await importedTotalsQuery(clickhouse, input.websiteId, [
    readFor(input.imported?.current, null),
    readFor(input.imported?.comparison, null),
  ]);

  const nativeCurrVisits = Number(row.visits || 0);
  const nativePrevVisits = Number(row.prev_visits || 0);

  const currVisitors = Number(row.visitors || 0) + impCurr.visitors;
  const prevVisitors = Number(row.prev_visitors || 0) + impPrev.visitors;

  const currVisits = nativeCurrVisits + impCurr.visits;
  const prevVisits = nativePrevVisits + impPrev.visits;

  const currPageviews = Number(row.pageviews || 0) + impCurr.pageviews;
  const prevPageviews = Number(row.prev_pageviews || 0) + impPrev.pageviews;

  // Rates divide by visits that carry bounces and seconds: imported page and
  // event rows add visits but neither (imported-plan.ts RATE_NEUTRAL_FAMILIES).
  const currRateVisits = nativeCurrVisits + impCurr.rate_visits;
  const prevRateVisits = nativePrevVisits + impPrev.rate_visits;
  const mergedDuration = (nativeAvg: number, nativeVisits: number, importedSeconds: number, rateVisits: number) =>
    rateVisits ? ((nativeAvg || 0) * nativeVisits + importedSeconds) / rateVisits : 0;
  const currDuration = mergedDuration(Number(row.visit_duration || 0), nativeCurrVisits, impCurr.visit_duration, currRateVisits);
  const prevDuration = mergedDuration(Number(row.prev_visit_duration || 0), nativePrevVisits, impPrev.visit_duration, prevRateVisits);

  const currBounces = Number(row.bounces || 0) + impCurr.bounces;
  const prevBounces = Number(row.prev_bounces || 0) + impPrev.bounces;

  const calcChange = (curr: number, prev: number) => {
    if (prev === 0 && curr === 0) return 0;
    if (prev === 0) return 100;
    return Math.round(((curr - prev) / prev) * 100);
  };

  const viewsPerVisit = currVisits ? currPageviews / currVisits : 0;
  const prevViewsPerVisit = prevVisits ? prevPageviews / prevVisits : 0;

  const bounceRate = currRateVisits ? (currBounces / currRateVisits) * 100 : 0;
  const prevBounceRate = prevRateVisits ? (prevBounces / prevRateVisits) * 100 : 0;

  return [
    {
      name: "Unique visitors",
      value: currVisitors,
      comparison_value: prevVisitors,
      change: calcChange(currVisitors, prevVisitors),
      graph_metric: "visitors",
    },
    {
      name: "Total visits",
      value: currVisits,
      comparison_value: prevVisits,
      change: calcChange(currVisits, prevVisits),
      graph_metric: "visits",
    },
    {
      name: "Total pageviews",
      value: currPageviews,
      comparison_value: prevPageviews,
      change: calcChange(currPageviews, prevPageviews),
      graph_metric: "pageviews",
    },
    {
      name: "Views per visit",
      value: Number(viewsPerVisit.toFixed(2)),
      comparison_value: Number(prevViewsPerVisit.toFixed(2)),
      change: calcChange(viewsPerVisit, prevViewsPerVisit),
      graph_metric: "views_per_visit",
    },
    {
      name: "Bounce rate",
      value: Math.round(bounceRate),
      comparison_value: Math.round(prevBounceRate),
      change: calcChange(bounceRate, prevBounceRate),
      graph_metric: "bounce_rate",
    },
    {
      name: "Visit duration",
      value: Math.round(currDuration),
      comparison_value: Math.round(prevDuration),
      change: calcChange(currDuration, prevDuration),
      graph_metric: "visit_duration",
    },
  ];
};
