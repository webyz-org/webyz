import { useState } from "react";
import { Link, useParams } from "react-router";

import PeriodPicker from "../features/dashboard/components/PeriodPicker";
import FilterBar from "../features/dashboard/components/FilterBar";
import FilterButton from "../features/dashboard/components/FilterButton";
import ExportMenu from "../features/dashboard/components/ExportMenu";
import SegmentsMenu from "../features/segments/components/SegmentsMenu";
import RetentionNotice from "../features/billing/components/RetentionNotice";
import SiteFavicon from "../features/websites/components/SiteFavicon";
import OutboundTrend from "../features/outbound/components/OutboundTrend";
import { DataList } from "../features/dashboard/components/DataList";
import BreakdownList from "../shared/components/BreakdownList";
import { useFilters } from "../features/dashboard/filters";
import {
  useBreakdown,
  useOutboundLinks,
  useOutboundSummary,
  useOutboundTimeseries,
} from "../features/dashboard/hooks/useDashboard";
import type { Column, OutboundGroup, OutboundRow } from "../features/dashboard/types";
import { useSiteByDomain } from "../features/websites/hooks/useWebsite";
import { periodQuery, usePeriod } from "../shared/hooks/usePeriod";
import { INTERVAL_LABELS, intervalOptionsFor } from "../config/periods";
import { countryFlag, countryName, formatCount, formatPercent } from "../shared/lib/format";
import PageHeader from "../shared/components/PageHeader";
import StatChange from "../shared/components/StatChange";
import StatGrid from "../shared/components/StatGrid";

const CONTAINER = "mx-auto max-w-[1280px] px-4 md:px-6";
const FAVICON_TONE = "bg-black/[0.05] text-text-secondary dark:bg-white/[0.08]";
const LIST_LIMIT = 12;

/**
 * A destination URL as people read it: no scheme, no trailing slash on a bare
 * host. Under a domain filter the host is the pill above, so rows show the
 * path and stop truncating to one identical prefix; a www. or subdomain
 * variant keeps its host, since that is what sets it apart. Same rule as the
 * dashboard card.
 */
const displayUrl = (url: string, withinDomain?: string) => {
  const bare = url.replace(/^https?:\/\//i, "").replace(/^([^/]+)\/$/, "$1");
  if (!withinDomain) return bare;
  if (bare === withinDomain) return "/";
  return bare.startsWith(`${withinDomain}/`) ? bare.slice(withinDomain.length) : bare;
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-xl border border-border bg-surface p-4">
    <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h2>
    <div className="mt-3">{children}</div>
  </section>
);

/** The change against the previous window; nothing when there was none. */
const Change = ({ now, before }: { now: number; before: number }) => {
  if (!before) return null;
  const change = Math.round(((now - before) / before) * 100);
  return change === 0 ? null : <StatChange delta={change} />;
};

/**
 * Outbound links: where visitors leave to, from which pages, and who they
 * are. The dashboard card answers the first question in seven rows; this
 * page holds the totals, the trend, the full lists, and, once a destination
 * is filtered in (click any row, or use the Filter button), who clicks out
 * to it: sources, countries, devices and browsers of those sessions. Every
 * control lives in the URL, so a filtered view is a link. File downloads
 * are deliberately not a tab here: they live in the Conversions card, the
 * `download` filter and the CSV export.
 */
export default function OutboundLinksPage() {
  const { domain } = useParams<{ domain: string }>();
  const { site, isLoading: siteLoading, notFound } = useSiteByDomain(domain);
  const { period, from, to, setPeriod } = usePeriod();
  const { filters, wire, hasFilters, setFilter } = useFilters();

  const intervalOptions = intervalOptionsFor(period);
  const [intervalChoice, setIntervalChoice] = useState<{ period: string; interval: string } | null>(null);
  const interval =
    intervalChoice?.period === period && (intervalOptions as string[]).includes(intervalChoice.interval)
      ? intervalChoice.interval
      : intervalOptions[0];

  const scope = { siteId: site?.id ?? "", period, from, to, filters: wire };
  const summary = useOutboundSummary(scope);
  const trend = useOutboundTimeseries(scope, interval);
  const domains = useOutboundLinks(scope, "domain", { limit: LIST_LIMIT });
  const links = useOutboundLinks(scope, "url", { limit: LIST_LIMIT });
  const pages = useOutboundLinks(scope, "page", { limit: LIST_LIMIT });

  // Who clicks out: only meaningful once the page is narrowed to a
  // destination, otherwise these would describe every visitor.
  const destination = filters.outbound_url?.value ?? filters.outbound_domain?.value;
  const audience = Boolean(destination);
  const whoOptions = { limit: 8, enabled: audience };
  const sources = useBreakdown(scope, "source", whoOptions);
  const countries = useBreakdown(scope, "countries", whoOptions);
  const devices = useBreakdown(scope, "devices", whoOptions);
  const browsers = useBreakdown(scope, "browsers", whoOptions);

  if (siteLoading) {
    return (
      <div className={CONTAINER + " py-10"}>
        <div className="h-24 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />
      </div>
    );
  }

  if (notFound || !site) {
    return (
      <div className={CONTAINER + " py-16 text-center"}>
        <h1 className="text-lg font-semibold">Site not found</h1>
        <Link to="/sites" className="mt-3 inline-block text-sm text-primary hover:underline">
          Back to sites
        </Link>
      </div>
    );
  }

  const s = summary.data;
  const cells = [
    { label: "Outbound clicks", value: formatCount(s?.clicks ?? 0), change: <Change now={s?.clicks ?? 0} before={s?.previous.clicks ?? 0} /> },
    { label: "Visitors who clicked", value: formatCount(s?.visitors ?? 0), change: <Change now={s?.visitors ?? 0} before={s?.previous.visitors ?? 0} /> },
    { label: "Click-through rate", value: formatPercent(s?.click_rate ?? 0), change: null },
    { label: "Clicks per visitor", value: String(s?.clicks_per_visitor ?? 0), change: null },
    { label: "Destinations", value: formatCount(s?.destinations ?? 0), change: <Change now={s?.destinations ?? 0} before={s?.previous.destinations ?? 0} /> },
    { label: "Pages clicked from", value: formatCount(s?.pages ?? 0), change: null },
  ];

  const columns = (label: string, render: (row: OutboundRow) => React.ReactNode): Column<OutboundRow>[] => [
    { key: "name", label, className: "flex-1 truncate pr-2", render },
    { key: "visitors", label: "Visitors", className: "w-16 text-right", render: (row) => formatCount(row.visitors) },
    { key: "clicks", label: "Clicks", className: "w-16 text-right", render: (row) => formatCount(row.clicks) },
    { key: "ctr", label: "CTR", className: "w-16 text-right", render: (row) => formatPercent(row.conversion_rate) },
  ];

  const rows = (q: { data?: { data: OutboundRow[] } }) => q.data?.data ?? [];
  const nothing = !summary.isLoading && !summary.isError && (s?.clicks ?? 0) === 0 && !hasFilters;

  // Clicking a row narrows the page to it.
  const filterFor = (by: OutboundGroup, name: string) => {
    if (by === "page") return setFilter("page", name);
    if (by === "domain") return setFilter("outbound_domain", name);
    return setFilter("outbound_url", name);
  };

  const list = (
    q: ReturnType<typeof useOutboundLinks>,
    by: OutboundGroup,
    label: string,
    render: (row: OutboundRow) => React.ReactNode,
  ) => (
    <DataList
      data={rows(q)}
      isLoading={q.isLoading}
      columns={columns(label, render)}
      emptyLabel="No outbound clicks for this period"
      onRowClick={(row) => {
        if (row.name) filterFor(by, row.name);
      }}
    />
  );

  const renderName = (by: OutboundGroup) => (row: OutboundRow) => {
    if (by === "domain") {
      return row.name ? (
        <span className="flex items-center gap-2">
          <SiteFavicon domain={row.name} tone={FAVICON_TONE} size="sm" />
          <span className="truncate">{row.name}</span>
        </span>
      ) : (
        "(unknown)"
      );
    }
    if (by === "url") {
      return (
        <span className="truncate" title={row.name}>
          {displayUrl(row.name, filters.outbound_domain?.op === "is" ? filters.outbound_domain.value : undefined)}
        </span>
      );
    }
    return row.name || "(none)";
  };

  const audienceRows = (q: ReturnType<typeof useBreakdown>) =>
    q.data?.data.map((r) => ({ name: r.name, visitors: r.visitors, percentage: r.percentage }));

  return (
    <div className={CONTAINER + " pb-12"}>
      <PageHeader
        siteName={site.name}
        title="Outbound links"
        description="Where visitors leave your site to, and from which pages. Click a row to filter by it."
        actions={
          <>
            <div className="flex flex-wrap items-center gap-2">
                      <FilterButton />
                      <SegmentsMenu mode="owner" siteId={site.id} canManage={site.role !== "viewer"} />
                      <PeriodPicker value={period} from={from} to={to} onChange={setPeriod} />
                      <ExportMenu scope={scope} />
                    </div>
          </>
        }
      />

      <RetentionNotice period={period} from={from} />
      <FilterBar />

      {summary.isError ? (
        <div className="rounded-xl border border-danger/30 bg-surface px-5 py-10 text-center">
          <p className="text-sm font-medium text-text-primary">Could not load outbound links.</p>
          <button
            type="button"
            onClick={() => void summary.refetch()}
            className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
          >
            Retry
          </button>
        </div>
      ) : nothing ? (
        <div className="rounded-xl border border-border bg-surface px-5 py-14 text-center">
          <p className="text-sm font-medium text-text-primary">No outbound link clicks in this period.</p>
          <p className="mt-1 text-[13px] text-text-muted">
            Counting them needs <code className="text-[12px]">data-outbound-links="true"</code> on the script tag, under{" "}
            <Link to={`/sites/${site.domain}/settings`} className="text-brand-ink hover:underline">
              site settings
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <StatGrid cells={cells} isLoading={summary.isLoading} />

          <section className="mt-4 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                {destination ? `Clicks to ${destination}` : "Outbound clicks over time"}
              </h2>
              {intervalOptions.length > 1 && (
                <select
                  value={interval}
                  onChange={(e) => setIntervalChoice({ period, interval: e.target.value })}
                  aria-label="Interval"
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-primary"
                >
                  {intervalOptions.map((o) => (
                    <option key={o} value={o}>
                      {INTERVAL_LABELS[o]}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="mt-3">
              <OutboundTrend series={trend.data} isLoading={trend.isLoading} />
            </div>
          </section>

          {/* Links get a full row: a URL is the longest label on the page, and
              in a third of the width every row truncated to one prefix. */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Section title="Destinations">{list(domains, "domain", "Domain", renderName("domain"))}</Section>
            <Section title="Pages clicked from">{list(pages, "page", "Page", renderName("page"))}</Section>
          </div>
          <div className="mt-4">
            <Section title="Links">{list(links, "url", "Link", renderName("url"))}</Section>
          </div>

          {audience && (
            <>
              <h2 className="mt-8 text-sm font-semibold text-text-primary">Who clicks out to {destination}</h2>
              <p className="mt-0.5 text-[13px] text-text-muted">
                Sessions in the period that clicked this destination at least once.
              </p>
              <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Section title="Sources">
                  <BreakdownList rows={audienceRows(sources)} isLoading={sources.isLoading} />
                </Section>
                <Section title="Countries">
                  <BreakdownList
                    rows={audienceRows(countries)}
                    isLoading={countries.isLoading}
                    formatName={(code) => `${countryFlag(code)} ${countryName(code)}`}
                  />
                </Section>
                <Section title="Devices">
                  <BreakdownList rows={audienceRows(devices)} isLoading={devices.isLoading} />
                </Section>
                <Section title="Browsers">
                  <BreakdownList rows={audienceRows(browsers)} isLoading={browsers.isLoading} />
                </Section>
              </div>
            </>
          )}

          <p className="mt-6 text-[12px] text-text-muted">
            Click any row to narrow the page to it. The{" "}
            <Link to={`/sites/${site.domain}?${periodQuery(period, from, to)}`} className="text-brand-ink hover:underline">
              overview
            </Link>{" "}
            keeps the same filters.
          </p>
        </>
      )}
    </div>
  );
}
