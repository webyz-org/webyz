import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import Sparkline from "./Sparkline";
import type { MetricSeries } from "../hooks/useDashboard";
import type { TopStat, TopStatsResponse } from "../types";
import { formatCount, formatDuration } from "../../../shared/lib/format";

const formatValue = (stat: TopStat) => {
  switch (stat.graph_metric) {
    case "bounce_rate":
      return `${stat.value}%`;
    case "visit_duration":
      return formatDuration(stat.value);
    case "views_per_visit":
      return stat.value.toFixed(2);
    default:
      return formatCount(stat.value);
  }
};

/** "vs previous 28 days", derived from the comparison window the API used. */
const compareLabel = (data?: TopStatsResponse) => {
  if (!data) return "";
  const days = Math.round((data.comparing_to - data.comparing_from) / 86_400);
  if (days <= 1) return "vs previous day";
  return `vs previous ${days} days`;
};

/**
 * The six KPIs as one control surface: a hairline grid rather than six
 * floating cards. Each tile is a button that selects the metric the chart
 * plots. Hierarchy per tile: label, value, change, comparison context, with a
 * sparkline of the period alongside.
 */
export default function TopStats({
  data,
  isLoading,
  series,
  metric,
  onMetricChange,
}: {
  data?: TopStatsResponse | null;
  isLoading: boolean;
  series: MetricSeries;
  metric: string;
  onMetricChange: (metric: string) => void;
}) {
  const stats = data?.top_stats ?? [];
  const context = compareLabel(data ?? undefined);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-surface px-5 py-4">
            <div className="h-3 w-20 animate-pulse rounded bg-black/[0.06] dark:bg-white/10" />
            <div className="mt-3 h-7 w-16 animate-pulse rounded bg-black/[0.06] dark:bg-white/10" />
            <div className="mt-2 h-3 w-28 animate-pulse rounded bg-black/[0.06] dark:bg-white/10" />
          </div>
        ))}
      </div>
    );
  }

  if (!stats.length) {
    return (
      <div className="px-5 py-8 text-center text-[13px] text-text-muted">
        No traffic recorded for this period yet.
      </div>
    );
  }

  return (
    <div
      role="tablist"
      aria-label="Metrics"
      className="grid grid-cols-2 gap-px bg-border md:grid-cols-3 xl:grid-cols-6"
    >
      {stats.map((stat) => {
        const selected = metric === stat.graph_metric;
        const isUp = stat.change > 0;
        const isFlat = stat.change === 0;
        // For bounce rate a rise is bad, so the colour is inverted.
        const good = stat.graph_metric === "bounce_rate" ? !isUp : isUp;
        const plot = series[stat.graph_metric as keyof MetricSeries]?.plot;

        return (
          <button
            key={stat.graph_metric}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onMetricChange(stat.graph_metric)}
            className={
              "group relative flex flex-col items-start bg-surface px-5 pb-4 pt-3.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 " +
              (selected
                ? "bg-primary-soft/40 dark:bg-primary-soft/60"
                : "hover:bg-black/[0.015] dark:hover:bg-white/[0.03]")
            }
          >
            <span
              className={
                "text-xs font-medium transition-colors duration-150 " +
                (selected
                  ? "text-brand-ink"
                  : "text-text-muted group-hover:text-text-secondary")
              }
            >
              {stat.name}
            </span>

            <span className="mt-2 flex w-full items-end justify-between gap-3">
              {/* Never wraps: a duration such as "5m 34s" used to break onto
                  two lines and stretch every card in the row. The sparkline
                  gives way instead. */}
              <span className="whitespace-nowrap text-[26px] font-semibold leading-none tracking-tight tabular-nums text-text-primary">
                {formatValue(stat)}
              </span>
              {plot && plot.length > 1 && (
                <Sparkline
                  values={plot}
                  fit
                  className={
                    "mb-0.5 transition-colors duration-150 " +
                    (selected ? "text-brand" : "text-text-muted/50")
                  }
                />
              )}
            </span>

            <span className="mt-2 flex items-center gap-1.5 text-xs tabular-nums">
              <span
                className={
                  "inline-flex items-center gap-px font-medium " +
                  (isFlat
                    ? "text-text-muted"
                    : good
                      ? "text-[#0a7a4d] dark:text-emerald-400"
                      : "text-[#b3261e] dark:text-red-400")
                }
              >
                {isFlat ? (
                  <Minus size={12} strokeWidth={2.25} />
                ) : isUp ? (
                  <ArrowUpRight size={12} strokeWidth={2.25} />
                ) : (
                  <ArrowDownRight size={12} strokeWidth={2.25} />
                )}
                {Math.abs(stat.change)}%
              </span>
              <span className="truncate text-text-muted">{context}</span>
            </span>

            {/* Selection indicator: a short bar along the bottom edge. */}
            <span
              aria-hidden
              className={
                "absolute inset-x-0 bottom-0 h-0.5 transition-colors duration-150 " +
                (selected ? "bg-brand" : "bg-transparent")
              }
            />
          </button>
        );
      })}
    </div>
  );
}
