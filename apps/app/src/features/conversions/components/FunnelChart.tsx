import { formatCount } from "../../../shared/lib/format";
import type { FunnelAnalysis, FunnelMetric } from "../types";

/**
 * The funnel visualization: one column per step, bar height scaled to step 1,
 * with each step's count, share of entrants, and the drop-off from the
 * previous step. Pure divs - no chart library needed for bars.
 */
export default function FunnelChart({
  analysis,
  metric,
}: {
  analysis: FunnelAnalysis;
  metric: FunnelMetric;
}) {
  const { steps, entered } = analysis;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-xl font-semibold">
          {analysis.conversion_rate}%
        </span>
        <span className="text-sm text-text-muted">
          overall conversion · {formatCount(analysis.completed)} of{" "}
          {formatCount(entered)} {metric} completed all {steps.length} steps
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <div
          className="flex min-w-[480px] items-stretch gap-2"
          role="img"
          aria-label={`Funnel: ${steps
            .map((s) => `${s.label} ${formatCount(metric === "sessions" ? s.sessions : s.visitors)}`)
            .join(", ")}`}
        >
          {steps.map((step, i) => {
            const count = metric === "sessions" ? step.sessions : step.visitors;
            const height = entered > 0 ? Math.max((count / entered) * 100, count > 0 ? 2 : 0) : 0;

            return (
              <div key={step.position} className="min-w-0 flex-1">
                {/* Drop-off from the previous step sits above the bar. */}
                <div className="h-5 text-center text-xs">
                  {i > 0 && step.drop_off > 0 && (
                    <span className="text-danger">-{step.drop_off}%</span>
                  )}
                </div>

                <div className="flex h-40 items-end rounded-md bg-black/[0.03] dark:bg-white/[0.05] px-1.5 pt-1.5">
                  <div
                    className="w-full rounded-t-sm bg-primary/80"
                    style={{ height: `${height}%` }}
                  />
                </div>

                <div className="mt-2 text-center">
                  <div className="text-base font-semibold tabular-nums">
                    {formatCount(count)}
                  </div>
                  <div className="text-xs text-text-muted">
                    {step.conversion_rate}%
                  </div>
                  <div
                    className="mt-1 truncate text-xs font-medium"
                    title={step.label}
                  >
                    {step.position}. {step.label}
                  </div>
                  <div className="text-[11px] text-text-muted">
                    {step.event_name ? "Event" : "Page"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
