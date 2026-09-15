import { Link } from "react-router";
import { ArrowDownRight, ArrowUpRight, Minus, Settings } from "lucide-react";

import SiteFavicon from "./SiteFavicon";
import Sparkline from "../../dashboard/components/Sparkline";
import {
  useMainGraph,
  useRealtime,
  useTopStats,
} from "../../dashboard/hooks/useDashboard";
import type { TopStat } from "../../dashboard/types";
import { formatCount } from "../../../shared/lib/format";
import type { Website } from "../types";

/**
 * The list period. Fixed at seven days so every row is comparable, and
 * because the same key is the dashboard's default, opening a site reuses
 * these cached responses instead of refetching.
 */
const PERIOD = "last_7_days";

const statFor = (stats: TopStat[] | null | undefined, metric: string) =>
  stats?.find((s) => s.graph_metric === metric);

/** Change against the previous seven days. A rise in bounce rate is bad. */
function Change({ stat }: { stat?: TopStat }) {
  if (!stat || stat.change === 0) {
    return (
      <span className="inline-flex items-center gap-px text-text-muted">
        <Minus size={11} strokeWidth={2.25} />
        0%
      </span>
    );
  }

  const isUp = stat.change > 0;
  const good = stat.graph_metric === "bounce_rate" ? !isUp : isUp;

  return (
    <span
      className={
        "inline-flex items-center gap-px font-medium " +
        (good
          ? "text-[#0a7a4d] dark:text-emerald-400"
          : "text-[#b3261e] dark:text-red-400")
      }
    >
      {isUp ? (
        <ArrowUpRight size={11} strokeWidth={2.25} />
      ) : (
        <ArrowDownRight size={11} strokeWidth={2.25} />
      )}
      {Math.abs(stat.change)}%
    </span>
  );
}

function Metric({
  label,
  value,
  stat,
  loading,
}: {
  label: string;
  value: string;
  stat?: TopStat;
  loading: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-text-muted">{label}</p>
      {loading ? (
        <div className="mt-1.5 h-5 w-14 animate-pulse rounded bg-black/[0.06] dark:bg-white/10" />
      ) : (
        <p className="mt-1 text-[19px] font-semibold leading-none tracking-tight tabular-nums text-text-primary">
          {value}
        </p>
      )}
      <p className="mt-1.5 text-[11px] tabular-nums">
        {loading ? " " : <Change stat={stat} />}
      </p>
    </div>
  );
}

/**
 * One website as a full-width row: identity on the left, the seven-day
 * numbers and their trend on the right. The row is a link to the dashboard;
 * settings sits above it.
 */
export default function SiteRow({
  site,
  tone,
}: {
  site: Website;
  tone: string;
}) {
  const scope = { siteId: site.id, period: PERIOD };

  const { data: top, isLoading } = useTopStats(scope);
  const { data: graph } = useMainGraph(scope, "visitors", "day");
  const { data: live } = useRealtime(site.id, 30_000);

  const visitors = statFor(top?.top_stats, "visitors");
  const pageviews = statFor(top?.top_stats, "pageviews");
  const bounce = statFor(top?.top_stats, "bounce_rate");

  const current = live?.current_visitors ?? 0;
  const quiet = !isLoading && (visitors?.value ?? 0) === 0;

  return (
    <div className="group relative rounded-xl border border-border bg-surface transition-colors duration-150 hover:border-border-strong">
      <div className="flex flex-col gap-5 p-4 lg:flex-row lg:items-center lg:gap-6 lg:p-5">
        {/* Identity */}
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <SiteFavicon domain={site.domain} tone={tone} />

          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-[15px] font-semibold tracking-tight text-text-primary">
                {site.name}
              </h2>
              {site.isBlocked && (
                <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                  Paused
                </span>
              )}
              {site.isPublic && (
                <span className="shrink-0 rounded bg-primary-soft px-1.5 py-0.5 text-[11px] font-medium text-brand-ink">
                  Public
                </span>
              )}
              {site.role && site.role !== "owner" && (
                <span
                  className="shrink-0 rounded bg-black/[0.05] px-1.5 py-0.5 text-[11px] font-medium text-text-secondary dark:bg-white/[0.08]"
                  title="Shared with you"
                >
                  {site.role === "admin" ? "Admin" : "Viewer"}
                </span>
              )}
            </div>
            <p className="truncate text-[13px] text-text-muted">
              {site.domain}
              {quiet && (
                <span className="ml-2 text-text-muted">
                  · no visits in the last 7 days
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Live now */}
        <div className="min-w-[86px] lg:shrink-0">
          <p className="text-xs text-text-muted">Live</p>
          <p className="mt-1 flex items-center gap-1.5 text-[19px] font-semibold leading-none tracking-tight tabular-nums text-text-primary">
            <span
              className={
                "h-2 w-2 shrink-0 rounded-full " +
                (current > 0 ? "bg-success" : "bg-border-strong")
              }
              aria-hidden
            />
            {current}
          </p>
          <p className="mt-1.5 text-[11px] text-text-muted">right now</p>
        </div>

        {/* Seven-day numbers */}
        <div className="grid flex-1 grid-cols-3 gap-x-5 lg:max-w-[340px] lg:shrink-0">
          <Metric
            label="Visitors"
            value={formatCount(visitors?.value ?? 0)}
            stat={visitors}
            loading={isLoading}
          />
          <Metric
            label="Pageviews"
            value={formatCount(pageviews?.value ?? 0)}
            stat={pageviews}
            loading={isLoading}
          />
          <Metric
            label="Bounce"
            value={`${bounce?.value ?? 0}%`}
            stat={bounce}
            loading={isLoading}
          />
        </div>

        {/* Trend and settings */}
        <div className="flex items-center gap-4 lg:shrink-0">
          {graph && graph.plot.length > 1 ? (
            <Sparkline
              values={graph.plot}
              width={96}
              height={30}
              className="text-brand"
            />
          ) : (
            <span className="h-[30px] w-24" aria-hidden />
          )}

          <Link
            to={`/sites/${site.domain}/settings`}
            className="relative z-10 flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-black/[0.04] hover:text-text-primary dark:hover:bg-white/[0.06]"
            aria-label={`${site.name} settings`}
            title="Site settings"
          >
            <Settings size={15} />
          </Link>
        </div>
      </div>

      {/* Whole row opens the dashboard; the settings button sits above it. */}
      <Link
        to={`/sites/${site.domain}`}
        aria-label={`Open ${site.name}`}
        className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
    </div>
  );
}
