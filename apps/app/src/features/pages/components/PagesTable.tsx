import { Link } from "react-router";
import { ArrowDown, ArrowUp } from "lucide-react";

import Sparkline from "./Sparkline";
import {
  formatCount,
  formatDuration,
  formatPercent,
} from "../../../shared/lib/format";
import type {
  PageDisplayMode,
  PageEntry,
  PagesResponse,
  PagesSortKey,
  PagesSortOrder,
} from "../types";

const COLUMNS: Array<{
  key: string;
  label: string;
  sort?: PagesSortKey;
  align?: "right";
}> = [
  { key: "page", label: "Page" },
  { key: "trend", label: "Trend", sort: "trend" },
  { key: "views", label: "Views", sort: "views", align: "right" },
  { key: "sessions", label: "Sessions", sort: "sessions", align: "right" },
  { key: "bounce", label: "Bounce", sort: "bounce_rate", align: "right" },
  { key: "duration", label: "Duration", sort: "duration", align: "right" },
  // Webyz does not track revenue yet; the column renders an empty value
  // rather than inventing numbers, and is not sortable for the same reason.
  { key: "revenue", label: "Revenue", align: "right" },
];

/** ±% vs the previous equal-length period; "new" when it had no views then. */
const ChangeBadge = ({ entry }: { entry: PageEntry }) => {
  if (entry.prev_views === 0) {
    return entry.views > 0 ? (
      <span className="text-[11px] font-medium text-success">new</span>
    ) : null;
  }
  if (entry.change === 0) return null;

  const up = entry.change > 0;
  return (
    <span
      className={
        "text-[11px] font-medium " + (up ? "text-success" : "text-danger")
      }
    >
      {up ? "+" : ""}
      {entry.change}%
    </span>
  );
};

export default function PagesTable({
  data,
  isLoading,
  mode,
  domain,
  sort,
  order,
  onSort,
  detailHref,
  onPageChange,
  onLimitChange,
}: {
  data?: PagesResponse;
  isLoading: boolean;
  mode: PageDisplayMode;
  domain: string;
  sort: PagesSortKey;
  order: PagesSortOrder;
  onSort: (key: PagesSortKey) => void;
  detailHref: (path: string) => string;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}) {
  const rows = data?.results ?? [];
  const meta = data?.meta;

  const displayName = (path: string) =>
    mode === "url" ? `https://${domain}${path}` : path;

  const first = meta ? (meta.page - 1) * meta.limit + 1 : 0;
  const last = meta ? (meta.page - 1) * meta.limit + rows.length : 0;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total_items / meta.limit)) : 1;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              {COLUMNS.map((col) => {
                const active = col.sort === sort;
                const ariaSort = col.sort
                  ? active
                    ? order === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                  : undefined;

                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={ariaSort as React.AriaAttributes["aria-sort"]}
                    className={
                      "px-4 py-3 font-medium " +
                      (col.align === "right" ? "text-right" : "")
                    }
                  >
                    {col.sort ? (
                      <button
                        type="button"
                        onClick={() => onSort(col.sort!)}
                        className={
                          "inline-flex items-center gap-1 uppercase tracking-wide hover:text-text-primary " +
                          (active ? "text-text-primary" : "")
                        }
                        aria-label={`Sort by ${col.label}`}
                      >
                        {col.label}
                        {active &&
                          (order === "asc" ? (
                            <ArrowUp size={12} />
                          ) : (
                            <ArrowDown size={12} />
                          ))}
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {isLoading && !rows.length
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/60">
                    {COLUMNS.map((col) => (
                      <td key={col.key} className="px-4 py-3.5">
                        <div className="h-3.5 w-full max-w-24 animate-pulse rounded bg-black/5 dark:bg-white/10" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((entry) => (
                  <tr
                    key={entry.path}
                    className="group border-b border-border/60 last:border-b-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.04]"
                  >
                    <td className="max-w-72 px-4 py-2.5">
                      <Link
                        to={detailHref(entry.path)}
                        className="block outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {entry.title && (
                          <span
                            className="block truncate font-medium group-hover:text-primary"
                            title={entry.title}
                          >
                            {entry.title}
                          </span>
                        )}
                        <span
                          className={
                            "block truncate " +
                            (entry.title
                              ? "text-xs text-text-muted"
                              : "font-medium group-hover:text-primary")
                          }
                          title={displayName(entry.path)}
                        >
                          {displayName(entry.path)}
                        </span>
                      </Link>
                    </td>

                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Sparkline
                          values={entry.spark}
                          labels={data?.trend_labels ?? []}
                          interval={data?.interval ?? "day"}
                        />
                        <ChangeBadge entry={entry} />
                      </div>
                    </td>

                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {formatCount(entry.views)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCount(entry.sessions)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatPercent(entry.bounce_rate)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatDuration(entry.avg_duration)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-text-muted">
                      —
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {meta && meta.total_items > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-text-muted">
          <span>
            Showing {first}–{last} of {meta.total_items}
          </span>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5">
              Rows
              <select
                value={meta.limit}
                onChange={(e) => onLimitChange(Number(e.target.value))}
                className="h-7 rounded-md border border-border bg-surface px-1 text-xs outline-none"
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPageChange(meta.page - 1)}
                disabled={meta.page <= 1}
                className="rounded-md border border-border px-2.5 py-1 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] disabled:opacity-40"
              >
                Previous
              </button>
              <span className="tabular-nums">
                {meta.page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => onPageChange(meta.page + 1)}
                disabled={!meta.has_more}
                className="rounded-md border border-border px-2.5 py-1 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
