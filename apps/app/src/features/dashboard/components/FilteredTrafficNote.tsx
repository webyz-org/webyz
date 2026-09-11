import { ShieldCheck } from "lucide-react";

import type { AnalyticsScope } from "../api";
import { useFilteredTraffic } from "../hooks/useDashboard";
import { formatCount } from "../../../shared/lib/format";

const REASON_LABELS: Record<string, string> = {
  bot_user_agent: "known bots and crawlers",
  datacenter_ip: "data-centre and hosting addresses",
  referrer_spam: "referrer spam",
  scripted_cluster: "scripted browser traffic",
};

/**
 * One quiet line under the overview: how many requests the ingest filters
 * refused in this period, with the split by reason on hover. The figure is
 * what makes the bot filtering checkable rather than taken on trust; Cloudflare
 * shows the same number for the same reason. Nothing renders when there is
 * nothing to say, so a clean site's dashboard is unchanged.
 */
export default function FilteredTrafficNote({ scope }: { scope: AnalyticsScope }) {
  const { data } = useFilteredTraffic(scope);
  if (!data || data.total === 0) return null;

  const detail = Object.entries(data.reasons)
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([reason, n]) => `${formatCount(n)} ${REASON_LABELS[reason] ?? reason}`)
    .join(", ");

  return (
    <p
      className="mt-2 flex items-center gap-1.5 px-1 text-[12px] text-text-muted"
      title={detail}
    >
      <ShieldCheck size={13} className="shrink-0" aria-hidden />
      <span>
        {formatCount(data.total)} requests from bots were filtered out of this period and are not counted
        above.
      </span>
    </p>
  );
}
