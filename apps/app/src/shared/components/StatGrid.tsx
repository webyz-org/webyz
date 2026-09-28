import type { ReactNode } from "react";

export type StatCell = {
  label: string;
  value: ReactNode;
  /** Usually a <StatChange />; sits beside the value. */
  change?: ReactNode;
  /** For text values (a page path) that must not stretch the tile. */
  truncate?: boolean;
};

// Written out in full so Tailwind sees every class.
const COLUMNS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 md:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 md:grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-2 md:grid-cols-3 lg:grid-cols-6",
};

/**
 * The read-only KPI strip on the site sub-pages (Pages, Page detail,
 * Outbound, Search, Goal detail). Deliberately not the Overview's TopStats:
 * those tiles are tabs that drive the chart, and these are a compact summary
 * with the change sitting beside the value.
 */
export default function StatGrid({
  cells,
  isLoading = false,
}: {
  cells: StatCell[];
  /** Keeps the labels and shimmers the values. */
  isLoading?: boolean;
}) {
  return (
    <div
      className={
        "grid gap-px overflow-hidden rounded-xl border border-border bg-border " +
        (COLUMNS[cells.length] ?? COLUMNS[6])
      }
    >
      {cells.map((cell) => (
        <div key={cell.label} className="min-w-0 bg-surface p-4">
          <span className="text-xs font-medium text-text-muted">{cell.label}</span>
          <div className="mt-1 flex min-w-0 items-baseline gap-2">
            {isLoading ? (
              <div className="h-6 w-14 animate-pulse rounded bg-black/5 dark:bg-white/10" />
            ) : (
              <>
                <span
                  className={
                    "font-semibold " +
                    (cell.truncate ? "truncate text-base leading-7" : "text-xl")
                  }
                  title={cell.truncate && typeof cell.value === "string" ? cell.value : undefined}
                >
                  {cell.value}
                </span>
                {cell.change}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
