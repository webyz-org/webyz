import { Link } from "react-router";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";

import { useBreakdown } from "../hooks/useDashboard";
import type { AnalyticsScope } from "../api";
import type { MetricSeries } from "../hooks/useDashboard";
import type { TopStatsResponse } from "../types";
import { formatBucketTitle } from "../labels";

/**
 * One sentence under the chart, computed from data already on the page plus
 * the top channel: how visitors moved against the previous period, when they
 * peaked, and what led. Renders nothing when there is nothing to say.
 */
export default function Insight({
  scope,
  stats,
  series,
  detailsHref,
}: {
  scope: AnalyticsScope;
  stats?: TopStatsResponse | null;
  series: MetricSeries;
  detailsHref?: string;
}) {
  const channels = useBreakdown(scope, "channel", { limit: 1 });

  const visitors = stats?.top_stats?.find((s) => s.graph_metric === "visitors");
  const plot = series.visitors?.plot ?? [];
  const labels = series.visitors?.labels ?? [];

  if (!visitors || visitors.value === 0 || plot.length < 2) return null;

  const peakIndex = plot.indexOf(Math.max(...plot));
  const peak = labels[peakIndex]
    ? formatBucketTitle(labels[peakIndex], series.visitors?.interval ?? "day")
    : null;
  const topChannel = channels.data?.data?.[0]?.name;

  const change = visitors.change;
  const days = stats
    ? Math.round((stats.comparing_to - stats.comparing_from) / 86_400)
    : 0;
  const window = days <= 1 ? "the previous day" : `the previous ${days} days`;

  const Icon = change < 0 ? TrendingDown : TrendingUp;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border px-5 py-3 text-[13px] text-text-secondary">
      <p className="flex min-w-0 items-center gap-2.5">
        <Icon
          size={15}
          strokeWidth={1.9}
          className={
            change === 0
              ? "shrink-0 text-text-muted"
              : change > 0
                ? "shrink-0 text-[#0a7a4d] dark:text-emerald-400"
                : "shrink-0 text-[#b3261e] dark:text-red-400"
          }
        />
        <span className="min-w-0">
          {change === 0 ? (
            <>
              <span className="font-medium text-text-primary">
                Visitors unchanged
              </span>{" "}
              against {window}.
            </>
          ) : (
            <>
              <span className="font-medium text-text-primary">
                {Math.abs(change)}% {change > 0 ? "more" : "fewer"} visitors
              </span>{" "}
              than {window}.
            </>
          )}
          {peak && (
            <>
              {" "}
              Traffic peaked on{" "}
              <span className="font-medium text-text-primary">{peak}</span>
              {topChannel && (
                <>
                  , led by{" "}
                  <span className="font-medium text-text-primary">
                    {topChannel}
                  </span>
                </>
              )}
              .
            </>
          )}
        </span>
      </p>

      {detailsHref && (
        <Link
          to={detailsHref}
          className="inline-flex shrink-0 items-center gap-1 font-medium text-text-secondary transition-colors duration-150 hover:text-text-primary"
        >
          View pages
          <ArrowRight size={13} />
        </Link>
      )}
    </div>
  );
}
