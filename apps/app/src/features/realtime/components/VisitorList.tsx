import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { countryFlag, countryName } from "../../../shared/lib/format";
import { browserLabel, timeAgo } from "../time";
import type { Visitor } from "../types";

/**
 * Live list of visitors in the window, most recent activity first. Rows are
 * buttons (the accessible equivalent of the map markers); the selected row is
 * kept scrolled into view so map -> list selection stays visible.
 */
export default function VisitorList({
  visitors,
  now,
  activeCutoff,
  selectedVisitorId,
  countryFilter,
  onClearCountryFilter,
  onSelect,
}: {
  visitors: Visitor[];
  now: number;
  activeCutoff: number;
  selectedVisitorId: string | null;
  countryFilter: string | null;
  onClearCountryFilter: () => void;
  onSelect: (visitorId: string) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedVisitorId]);

  const filtered = countryFilter
    ? visitors.filter((v) => v.country === countryFilter)
    : visitors;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {filtered.length} visitor{filtered.length === 1 ? "" : "s"}
        </h2>
        {countryFilter && (
          <button
            type="button"
            onClick={onClearCountryFilter}
            className="flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary"
          >
            {countryFlag(countryFilter)} {countryName(countryFilter)}
            <X size={12} aria-label="Clear country filter" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-text-muted">
          No active visitors
        </p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {filtered.map((visitor) => {
            const selected = visitor.visitorId === selectedVisitorId;
            const active = visitor.lastActiveAt >= activeCutoff;
            return (
              <li key={visitor.visitorId}>
                <button
                  ref={selected ? selectedRef : undefined}
                  type="button"
                  onClick={() => onSelect(visitor.visitorId)}
                  aria-pressed={selected}
                  className={
                    "block w-full px-4 py-2.5 text-left transition-colors " +
                    (selected ? "bg-primary-soft" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.05]")
                  }
                >
                  <span className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-1.5 font-medium">
                      <span aria-hidden>
                        {countryFlag(visitor.country) || "🌐"}
                      </span>
                      <span className="truncate">
                        {visitor.country
                          ? countryName(visitor.country)
                          : "Unknown"}
                        {visitor.city ? ` · ${visitor.city}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
                      {active && (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-success"
                          aria-label="Active now"
                        />
                      )}
                      {timeAgo(now, visitor.lastActiveAt)}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2 text-xs text-text-muted">
                    <span className="truncate" title={visitor.currentPath}>
                      {visitor.currentPath || "-"}
                    </span>
                    <span className="shrink-0">
                      {[browserLabel(visitor.browser), visitor.device]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
