import { formatCount, formatDuration, formatPercent } from "../../../shared/lib/format";
import type { PagesSummary as Summary } from "../types";

/** The compact answer strip above the table, same visual grid as TopStats. */
export default function PagesSummary({
  summary,
  isLoading,
}: {
  summary?: Summary;
  isLoading: boolean;
}) {
  if (isLoading && !summary) {
    return (
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-surface p-4">
            <div className="h-3 w-20 animate-pulse rounded bg-black/5 dark:bg-white/10" />
            <div className="mt-3 h-6 w-14 animate-pulse rounded bg-black/5 dark:bg-white/10" />
          </div>
        ))}
      </div>
    );
  }

  const cells = [
    { label: "Pages", value: formatCount(summary?.pages ?? 0) },
    { label: "Pageviews", value: formatCount(summary?.pageviews ?? 0) },
    { label: "Sessions", value: formatCount(summary?.sessions ?? 0) },
    { label: "Avg. bounce", value: formatPercent(summary?.bounce_rate ?? 0) },
    {
      label: "Avg. duration",
      value: formatDuration(summary?.avg_duration ?? 0),
    },
    { label: "Top page", value: summary?.top_page ?? "—", truncate: true },
  ];

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3 lg:grid-cols-6">
      {cells.map((cell) => (
        <div key={cell.label} className="min-w-0 bg-surface p-4">
          <span className="text-xs uppercase tracking-wide text-text-muted">
            {cell.label}
          </span>
          <div
            className={
              "mt-1 text-xl font-semibold " +
              (cell.truncate ? "truncate text-base leading-7" : "")
            }
            title={cell.truncate ? String(cell.value) : undefined}
          >
            {cell.value}
          </div>
        </div>
      ))}
    </div>
  );
}
