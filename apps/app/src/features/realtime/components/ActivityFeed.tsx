import { countryName } from "../../../shared/lib/format";
import { timeAgo } from "../time";
import type { ActivityItem } from "../types";

/** Secondary live feed: the site's latest pageviews and events. */
export default function ActivityFeed({
  items,
  now,
}: {
  items: ActivityItem[];
  now: number;
}) {
  if (items.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-text-muted">
        Activity will appear here as visitors browse.
      </p>
    );
  }

  return (
    <ul className="min-h-0 divide-y divide-border overflow-y-auto">
      {items.map((item, index) => (
        <li
          key={`${item.ts}-${item.visitorId}-${index}`}
          className="flex items-start gap-2 px-4 py-2 text-sm"
        >
          <span
            className={
              "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full " +
              (item.kind === "pageview" ? "bg-primary" : "bg-success")
            }
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate">
              Visitor{item.country ? ` from ${countryName(item.country)}` : ""}{" "}
              {item.kind === "pageview" ? (
                <>viewed {item.path}</>
              ) : (
                <>
                  triggered <span className="font-medium">{item.name}</span>
                </>
              )}
            </span>
            <span className="text-xs text-text-muted">
              {timeAgo(now, item.ts)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
