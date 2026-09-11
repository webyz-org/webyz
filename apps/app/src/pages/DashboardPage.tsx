import { Link, useParams } from "react-router";
import { Check, Copy, MoreHorizontal, Settings, Share2 } from "lucide-react";
import { useState } from "react";

import OverviewSurface from "../features/dashboard/components/OverviewSurface";
import FilteredTrafficNote from "../features/dashboard/components/FilteredTrafficNote";
import ContentsCard from "../features/dashboard/components/ContentsCard";
import TechnologyCard from "../features/dashboard/components/TechnologyCard";
import AcquisitionCard from "../features/dashboard/components/AcquisitionCard";
import GeographyCard from "../features/dashboard/components/GeographyCard";
import ConversionCard from "../features/dashboard/components/ConversionCard";
import PeriodPicker from "../features/dashboard/components/PeriodPicker";
import RealtimeBadge from "../features/dashboard/components/RealtimeBadge";
import FilterBar from "../features/dashboard/components/FilterBar";
import FilterButton from "../features/dashboard/components/FilterButton";
import ExportMenu from "../features/dashboard/components/ExportMenu";
import SegmentsMenu from "../features/segments/components/SegmentsMenu";
import RetentionNotice from "../features/billing/components/RetentionNotice";
import { useFilters } from "../features/dashboard/filters";
import { useSiteByDomain } from "../features/websites/hooks/useWebsite";
import { useUsageSummary } from "../features/billing/hooks/useBilling";
import { periodQuery, usePeriod } from "../shared/hooks/usePeriod";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../shared/components/ui/dropdown-menu";

const CONTAINER = "mx-auto max-w-[1280px] px-4 md:px-6";

export default function DashboardPage() {
  const { domain } = useParams<{ domain: string }>();
  const { site, isLoading, notFound, isError } = useSiteByDomain(domain);
  // Why ingest is paused, from the account's access state; the site row only
  // knows that it is.
  const usage = useUsageSummary();
  const pauseReason = (usage.data?.access as { reason?: string | null } | undefined)?.reason ?? null;

  // Period (and a custom range's dates) live in the URL so a dashboard view
  // can be linked and reloaded.
  const { period, from, to, setPeriod } = usePeriod();

  // Drill-down filters also live in the URL (f.* params) and narrow every
  // query on the page.
  const { wire: filters } = useFilters();

  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context); nothing to do.
    }
  };

  if (isLoading) {
    return (
      <div className={CONTAINER + " py-8"}>
        <div className="h-7 w-40 animate-pulse rounded bg-black/[0.06] dark:bg-white/10" />
        <div className="mt-6 h-[520px] animate-pulse rounded-2xl bg-black/[0.04] dark:bg-white/[0.06]" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className={CONTAINER + " py-20 text-center"}>
        <h1 className="text-xl font-semibold">Could not load your sites</h1>
        <p className="mt-1 text-[13px] text-text-muted">The API did not answer. Check your connection and try again.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 inline-block text-[13px] font-medium text-brand-ink hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (notFound || !site) {
    return (
      <div className={CONTAINER + " py-20 text-center"}>
        <h1 className="text-xl font-semibold">Site not found</h1>
        <p className="mt-1 text-[13px] text-text-muted">
          {domain} is not one of your sites.
        </p>
        <Link
          to="/sites"
          className="mt-4 inline-block text-[13px] font-medium text-brand-ink hover:underline"
        >
          Back to sites
        </Link>
      </div>
    );
  }

  const scope = { siteId: site.id, period, from, to, filters };
  const base = `/sites/${site.domain}`;

  return (
    <div className={CONTAINER + " pb-12"}>
      {/* Page header: identity left, period and filter controls right. */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-6 pt-8">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold leading-tight tracking-tight text-text-primary">
            {site.name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-text-secondary">
            <span className="truncate">{site.domain}</span>
            <span className="text-text-muted" aria-hidden>
              ·
            </span>
            <RealtimeBadge siteId={site.id} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <FilterButton />
          <SegmentsMenu mode="owner" siteId={site.id} canManage={site.role !== "viewer"} />
          <PeriodPicker value={period} from={from} to={to} onChange={setPeriod} />
          <ExportMenu scope={scope} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More actions"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition-colors duration-150 hover:border-border-strong hover:bg-accent/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <MoreHorizontal size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={copyLink}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Link copied" : "Copy link to this view"}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`${base}/settings?section=visibility`}>
                  <Share2 size={14} />
                  Share dashboard
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to={`${base}/settings`}>
                  <Settings size={14} />
                  Site settings
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <RetentionNotice period={period} from={from} />

      {!site.isActive && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-[13px]">
          Tracking is paused: this site is inactive on your current plan, which allows fewer websites.{" "}
          <Link to="/settings/billing" className="font-medium underline">
            Choose which sites stay active or upgrade
          </Link>
          .
        </div>
      )}
      {site.isActive && site.isBlocked && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-[13px]">
          {pauseReason === "SPEND_CAP" ? (
            <>
              Tracking is paused: this period reached the spending cap you set.{" "}
              <Link to="/settings/billing" className="font-medium underline">
                Raise the cap to resume
              </Link>
              .
            </>
          ) : pauseReason === "PAYMENT_FAILED" || pauseReason === "PAYMENT_GRACE" ? (
            <>
              Tracking is paused: a payment failed.{" "}
              <Link to="/settings/billing" className="font-medium underline">
                Update your payment method to resume
              </Link>
              .
            </>
          ) : pauseReason === "TRIAL_ENDED" ? (
            <>
              Tracking is paused: the trial ended and this site is over the free plan&apos;s allowance.{" "}
              <Link to="/settings/billing" className="font-medium underline">
                Upgrade to resume
              </Link>
              .
            </>
          ) : (
            <>
              Tracking is paused: this site has hit its monthly event limit.{" "}
              <Link to="/settings/billing" className="font-medium underline">
                Upgrade to resume
              </Link>
              .
            </>
          )}
        </div>
      )}

      <FilterBar />

      <OverviewSurface
        scope={scope}
        detailsHref={`${base}/pages?${periodQuery(period, from, to)}`}
      />
      <FilteredTrafficNote scope={scope} />

      {/* Key breakdowns: pages carry the most detail, so they get the wider
          column; sources sit beside them. */}
      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ContentsCard scope={scope} />
        <AcquisitionCard scope={scope} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <TechnologyCard scope={scope} />
        <GeographyCard scope={scope} />
        <ConversionCard scope={scope} siteDomain={site.domain} />
      </div>
    </div>
  );
}
