import { ChevronRight } from "lucide-react";

import type { Column } from "../types";

type Props<T> = {
  data: T[];
  isLoading?: boolean;
  columns: Column<T>[];
  maxItems?: number;
  emptyLabel?: string;
  /** Makes rows clickable; used to apply drill-down filters. */
  onRowClick?: (item: T) => void;
};

/**
 * Breakdown list: fixed 36px rows, a proportional bar behind the label
 * (scaled against the largest visible row), numeric columns to the right.
 * One restrained accent for every card; meaning comes from the numbers.
 */
export function DataList<T extends { name?: string; percentage?: number }>({
  data,
  isLoading,
  columns,
  maxItems,
  emptyLabel = "No data for this period",
  onRowClick,
}: Props<T>) {
  const [labelColumn, ...metricColumns] = columns;

  const header = (
    <div className="flex h-8 items-center gap-3 text-xs font-medium text-text-muted">
      <span className="min-w-0 flex-1 truncate pl-2">{labelColumn.label}</span>
      {metricColumns.map((col) => (
        <span key={col.key} className={col.className || "w-20 text-right"}>
          {col.label}
        </span>
      ))}
    </div>
  );

  if (isLoading) {
    return (
      <div aria-busy="true">
        {header}
        <div className="space-y-1">
          {Array.from({ length: maxItems ?? 5 }).map((_, i) => (
            <div key={i} className="flex h-9 items-center gap-3">
              <div
                className="h-5 animate-pulse rounded bg-black/[0.05] dark:bg-white/[0.08]"
                style={{ width: `${70 - i * 8}%` }}
              />
              <div className="ml-auto h-3.5 w-10 animate-pulse rounded bg-black/[0.05] dark:bg-white/[0.08]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center gap-1 text-center">
        <p className="text-[13px] text-text-muted">{emptyLabel}</p>
      </div>
    );
  }

  const items = maxItems ? data.slice(0, maxItems) : data;

  const maxPercentage = Math.max(
    ...items.map((item) =>
      typeof item.percentage === "number" ? Math.min(item.percentage, 100) : 0,
    ),
    0,
  );

  return (
    <div>
      {header}

      <div className="space-y-px">
        {items.map((item, index) => {
          // Breakdown rows have no id, and names can repeat across pages, so
          // the key combines the label with its position.
          const key = `${item.name ?? "row"}-${index}`;
          const clickable = Boolean(onRowClick && item.name);

          const barWidth =
            typeof item.percentage === "number" &&
            item.percentage > 0 &&
            maxPercentage > 0
              ? (Math.min(item.percentage, 100) / maxPercentage) * 100
              : 0;

          const content = (
            <div className="flex h-9 items-center gap-3">
              {/* Label track: the bar lives here, so the numbers on the right
                  stay outside it no matter how wide the bar grows. */}
              <div className="relative flex h-7 min-w-0 flex-1 items-center">
                {barWidth > 0 && (
                  <div
                    className="absolute inset-y-0 left-0 max-w-full rounded-[4px] bg-brand/[0.09] transition-[width,background-color] duration-200 group-hover:bg-brand/[0.14] dark:bg-brand/15 dark:group-hover:bg-brand/25"
                    style={{ width: `${barWidth}%` }}
                  />
                )}
                <div className="relative flex min-w-0 flex-1 items-center justify-between gap-2 px-2 text-[13px] text-text-primary">
                  <span className="min-w-0 truncate">
                    {labelColumn.render(item)}
                  </span>
                  {clickable && (
                    <ChevronRight
                      size={13}
                      className="shrink-0 text-text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                    />
                  )}
                </div>
              </div>

              {metricColumns.map((col) => (
                <span
                  key={col.key}
                  className={
                    "text-[13px] tabular-nums text-text-primary " +
                    (col.className || "w-20 text-right")
                  }
                >
                  {col.render(item)}
                </span>
              ))}
            </div>
          );

          return clickable ? (
            <button
              key={key}
              type="button"
              onClick={() => onRowClick!(item)}
              className="group block w-full cursor-pointer rounded-md text-left transition-colors duration-150 hover:bg-black/[0.015] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 dark:hover:bg-white/[0.03]"
            >
              {content}
            </button>
          ) : (
            <div key={key} className="group">
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
