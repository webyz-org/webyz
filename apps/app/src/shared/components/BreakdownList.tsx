import { formatCount } from "../lib/format";

export type BreakdownListRow = {
  name: string;
  visitors: number;
  percentage: number;
};

/** Name + visitors + percentage bar, the same shape as the dashboard lists. */
export default function BreakdownList({
  rows,
  isLoading,
  formatName,
}: {
  rows?: BreakdownListRow[];
  isLoading: boolean;
  formatName?: (name: string) => React.ReactNode;
}) {
  if (isLoading && !rows) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-6 animate-pulse rounded bg-black/5 dark:bg-white/10" />
        ))}
      </div>
    );
  }

  if (!rows?.length) {
    return <p className="text-sm text-text-muted">No data for this period.</p>;
  }

  return (
    <ul className="space-y-1">
      {rows.map((row) => (
        <li key={row.name} className="relative overflow-hidden rounded-md">
          <div
            className="absolute inset-y-0 left-0 bg-primary-soft/60"
            style={{ width: `${Math.min(row.percentage, 100)}%` }}
            aria-hidden
          />
          <div className="relative flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
            <span className="truncate">
              {formatName ? formatName(row.name) : row.name}
            </span>
            <span className="tabular-nums text-text-secondary">
              {formatCount(row.visitors)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
