import { useState } from "react";

import Insight from "./Insight";
import MainGraph from "./MainGraph";
import TopStats from "./TopStats";
import type { AnalyticsScope } from "../api";
import {
  useMetricSeries,
  useTopStats,
  type GraphMetric,
} from "../hooks/useDashboard";
import {
  intervalOptionsFor,
  type GraphInterval,
} from "../../../config/periods";

/**
 * KPI strip, main chart and insight line as one bordered surface, so picking
 * a KPI visibly switches the plot it sits on. Shared by the owner dashboard
 * and the public share page.
 */
export default function OverviewSurface({
  scope,
  detailsHref,
}: {
  scope: AnalyticsScope;
  detailsHref?: string;
}) {
  const [metric, setMetric] = useState<GraphMetric>("visitors");

  // The interval choice is remembered per period: changing the period resets
  // to that period's natural granularity rather than carrying "weekly" into
  // a one-day view.
  const intervalOptions = intervalOptionsFor(scope.period);
  const [intervalChoice, setIntervalChoice] = useState<{
    period: string;
    interval: GraphInterval;
  } | null>(null);
  const interval =
    intervalChoice?.period === scope.period &&
    intervalOptions.includes(intervalChoice.interval)
      ? intervalChoice.interval
      : intervalOptions[0];

  const topStats = useTopStats(scope);
  const { series, isPending, isError: seriesError } = useMetricSeries(scope, interval);

  // A failed request must not render as "no traffic yet": say it failed and
  // offer a retry, so nobody concludes their tracker is broken.
  if (topStats.isError || (seriesError && !isPending)) {
    return (
      <section
        aria-label="Overview"
        className="rounded-2xl border border-danger/30 bg-surface px-5 py-10 text-center"
      >
        <p className="text-sm font-medium text-text-primary">Could not load the overview.</p>
        <p className="mt-1 text-[13px] text-text-muted">
          {(topStats.error as { message?: string } | null)?.message ?? "The API did not answer."}
        </p>
        <button
          type="button"
          onClick={() => void topStats.refetch()}
          className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
        >
          Retry
        </button>
      </section>
    );
  }

  return (
    <section
      aria-label="Overview"
      className="overflow-hidden rounded-2xl border border-border bg-surface"
    >
      <TopStats
        data={topStats.data}
        isLoading={topStats.isLoading}
        series={series}
        metric={metric}
        onMetricChange={(m) => setMetric(m as GraphMetric)}
      />
      <div className="border-t border-border">
        <MainGraph
          series={series}
          isLoading={isPending}
          metric={metric}
          onMetricChange={setMetric}
          interval={interval}
          intervalOptions={intervalOptions}
          onIntervalChange={(next) =>
            setIntervalChoice({ period: scope.period, interval: next })
          }
        />
      </div>
      <Insight
        scope={scope}
        stats={topStats.data}
        series={series}
        detailsHref={detailsHref}
      />
    </section>
  );
}
