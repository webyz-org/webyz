import { Link, useParams, useSearchParams } from "react-router";
import { RotateCcw } from "lucide-react";

import JourneyFlow from "../features/dashboard/components/JourneyFlow";
import PeriodPicker from "../features/dashboard/components/PeriodPicker";
import { useJourneys } from "../features/dashboard/hooks/useDashboard";
import FeatureGate from "../features/billing/components/FeatureGate";
import RetentionNotice from "../features/billing/components/RetentionNotice";
import { useSiteByDomain } from "../features/websites/hooks/useWebsite";
import { usePeriod } from "../shared/hooks/usePeriod";
import type { JourneyMetric } from "../features/dashboard/types";

const DEPTHS = [1, 2, 3, 4, 5];
const DEFAULT_DEPTH = 5;

/**
 * Journeys: "after users visit this page, where do they go next?"
 *
 * Every control (period, metric, depth, selected starting path) lives in the
 * URL, so a view is linkable and the browser's back button walks back through
 * previously explored roots.
 */
export default function JourneysPage() {
  const { domain } = useParams<{ domain: string }>();
  const { site, isLoading: siteLoading, notFound } = useSiteByDomain(domain);

  const [searchParams, setSearchParams] = useSearchParams();
  const { period, from, to, setPeriod } = usePeriod();
  const metric: JourneyMetric =
    searchParams.get("metric") === "sessions" ? "sessions" : "users";
  const depthParam = Number(searchParams.get("depth"));
  const depth = DEPTHS.includes(depthParam) ? depthParam : DEFAULT_DEPTH;
  const startingPath = searchParams.get("path") ?? undefined;

  // Period/metric/depth changes replace the entry; picking a path pushes one,
  // so back returns to the previous journey context.
  const setParam = (key: string, value: string | null, push = false) => {
    const params = new URLSearchParams(searchParams);
    if (value === null) params.delete(key);
    else params.set(key, value);
    setSearchParams(params, { replace: !push });
  };

  const journeys = useJourneys(
    { siteId: site?.id ?? "", period, from, to },
    { metric, depth, startingPath },
  );

  if (siteLoading) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 md:px-6 py-10">
        <div className="h-24 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />
      </div>
    );
  }

  if (notFound || !site) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 md:px-6 py-16 text-center">
        <h1 className="text-lg font-semibold">Site not found</h1>
        <Link to="/sites" className="mt-3 inline-block text-sm text-primary hover:underline">
          Back to sites
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1280px] px-4 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <h1 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
            {site.name} · Journeys
          </h1>
          <p className="mt-0.5 text-xs text-text-muted">
            Where visitors go after each page. Click any page to follow that
            branch.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {startingPath && (
            <button
              type="button"
              onClick={() => setParam("path", null)}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
            >
              <RotateCcw size={14} />
              Reset
            </button>
          )}

          <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="Journey depth">
            {DEPTHS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setParam("depth", String(d))}
                className={
                  "px-2.5 py-2 text-sm " +
                  (d === depth
                    ? "bg-indigo-600 font-medium text-white"
                    : "hover:bg-black/[0.03] dark:hover:bg-white/[0.05]")
                }
                aria-pressed={d === depth}
              >
                {d}
              </button>
            ))}
          </div>

          <select
            value={metric}
            onChange={(e) => setParam("metric", e.target.value)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm outline-none"
            aria-label="Journey metric"
          >
            <option value="users">Users</option>
            <option value="sessions">Sessions</option>
          </select>

          <PeriodPicker value={period} from={from} to={to} onChange={setPeriod} />
        </div>
      </div>

      <FeatureGate
        feature="journeys"
        title="User journeys"
        description="See where visitors go after each page and follow any branch through your site."
      >
        <RetentionNotice period={period} from={from} />
        <div className="rounded-xl border border-border bg-surface p-4">
          <JourneyFlow
            data={journeys.data}
            isLoading={journeys.isLoading}
            isError={journeys.isError}
            onSelectPath={(path) => setParam("path", path, true)}
          />
        </div>
      </FeatureGate>

      <div className="h-10" />
    </div>
  );
}
