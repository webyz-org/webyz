import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MousePointerClick, Eye } from "lucide-react";

import { getVisitorActivity } from "../api";
import { countryFlag, countryName } from "../../../shared/lib/format";
import { browserLabel, clockLabel, timeAgo } from "../time";
import type { Visitor } from "../types";

/**
 * One visitor's detail panel: identity-free profile (location, device,
 * source), current page, and their recent trail. Everything shown is data
 * Webyz already stores per event; there is nothing here to fingerprint with.
 */
export default function VisitorDetails({
  visitor,
  siteId,
  windowMinutes,
  now,
  activeCutoff,
  onBack,
}: {
  visitor: Visitor | undefined;
  siteId: string;
  windowMinutes: number;
  now: number;
  activeCutoff: number;
  onBack: () => void;
}) {
  const activity = useQuery({
    queryKey: [
      "visitor-activity",
      siteId,
      visitor?.visitorId,
      windowMinutes,
    ],
    queryFn: () => getVisitorActivity(siteId, visitor!.visitorId, windowMinutes),
    enabled: Boolean(visitor),
    refetchInterval: 8000,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft size={13} />
          All visitors
        </button>
      </div>

      {!visitor ? (
        <p className="px-4 py-8 text-center text-sm text-text-muted">
          This visitor is no longer active.
        </p>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              <span aria-hidden>{countryFlag(visitor.country) || "🌐"}</span>
              {visitor.country ? countryName(visitor.country) : "Unknown"}
              {visitor.city ? ` · ${visitor.city}` : ""}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
              {visitor.lastActiveAt >= activeCutoff && (
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
              )}
              Active {timeAgo(now, visitor.lastActiveAt)} · first seen{" "}
              {timeAgo(now, visitor.firstSeenAt)}
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Current page
            </h3>
            <p
              className="mt-1 truncate rounded-md bg-black/[0.04] dark:bg-white/[0.06] px-2 py-1.5 text-sm"
              title={visitor.currentPath}
            >
              {visitor.currentPath || "-"}
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Recent activity
            </h3>
            {activity.isLoading ? (
              <div className="mt-2 space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-8 animate-pulse rounded bg-black/5 dark:bg-white/10" />
                ))}
              </div>
            ) : (
              <ul className="mt-1">
                {(activity.data ?? []).map((item, index) => (
                  <li
                    key={`${item.ts}-${index}`}
                    className="flex items-start gap-2 py-1.5 text-sm"
                  >
                    {item.event_type === "pageview" ? (
                      <Eye size={14} className="mt-0.5 shrink-0 text-text-muted" />
                    ) : (
                      <MousePointerClick
                        size={14}
                        className="mt-0.5 shrink-0 text-success"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate" title={item.path}>
                        {item.event_type === "pageview"
                          ? `Viewed ${item.path}`
                          : item.event_name}
                      </span>
                      <span className="text-xs text-text-muted">
                        {clockLabel(item.ts)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Traffic source
            </h3>
            <p className="mt-1 text-sm">
              {visitor.channel || visitor.referrerDomain || "Direct"}
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Device
            </h3>
            <p className="mt-1 text-sm">
              {[visitor.device, browserLabel(visitor.browser), visitor.os]
                .filter(Boolean)
                .join(" · ") || "Unknown"}
            </p>
          </div>

          <p className="pb-2 text-xs text-text-muted">
            {visitor.pageviews} pageview{visitor.pageviews === 1 ? "" : "s"} ·{" "}
            {visitor.events} event{visitor.events === 1 ? "" : "s"} in the last{" "}
            {windowMinutes} min
          </p>
        </div>
      )}
    </div>
  );
}
