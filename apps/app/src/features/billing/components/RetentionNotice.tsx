import { Link } from "react-router";

import { useEntitlements } from "../hooks/useEntitlements";

const DAY = 86_400_000;

/**
 * How many days back the selected period reaches, roughly: enough to know
 * whether it crosses the plan's retention. The API does the exact cut in the
 * site's timezone; this only decides whether to explain it.
 */
const daysBack = (period: string, from?: string): number => {
  switch (period) {
    case "today":
    case "last_24_hours":
      return 1;
    case "yesterday":
      return 2;
    case "last_7_days":
      return 7;
    case "last_28_days":
      return 28;
    case "last_30_days":
      return 30;
    case "last_91_days":
      return 91;
    case "this_month":
      return new Date().getDate();
    case "last_month":
      return new Date().getDate() + 31;
    case "this_year": {
      const now = new Date();
      return Math.ceil((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / DAY) + 1;
    }
    case "last_12_months":
      return 366;
    case "all_time":
      return Number.POSITIVE_INFINITY;
    case "custom": {
      if (!from) return 0;
      const start = Date.parse(from);
      return Number.isNaN(start) ? 0 : Math.ceil((Date.now() - start) / DAY);
    }
    default:
      return 0;
  }
};

/**
 * Shown under a period picker when the chosen period reaches back further
 * than the plan retains. Data older than the plan's window is not deleted; it
 * is not shown, and this says so instead of leaving a silently shorter chart.
 */
export default function RetentionNotice({ period, from }: { period: string; from?: string }) {
  const { entitlements, planName } = useEntitlements();
  if (!entitlements) return null;
  const days = entitlements.retention_days;
  if (daysBack(period, from) <= days) return null;

  return (
    <div className="mb-4 rounded-lg border border-border bg-surface px-4 py-3 text-[13px] text-text-secondary">
      Showing the last {days} days. The {planName ?? "current"} plan includes {days} days of history; older data is
      kept but not shown.{" "}
      <Link to="/settings/billing" className="font-medium text-primary hover:underline">
        Compare plans
      </Link>
    </div>
  );
}
