import { useState } from "react";
import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";

import AnalyticsCard from "./AnalyticsCard";
import SiteFavicon from "../../websites/components/SiteFavicon";
import { useOutboundLinks } from "../hooks/useDashboard";
import { useFilters } from "../filters";
import type { AnalyticsScope } from "../api";
import type { Column, OutboundGroup, OutboundRow, TabConfig } from "../types";
import { formatCount, formatPercent } from "../../../shared/lib/format";

/**
 * A destination URL as people read it: no scheme, no trailing slash on a bare
 * host. Under a domain drill the host is the filter pill above the card, so
 * rows show only the path and stop truncating to one identical prefix; a
 * subdomain or www. variant keeps its host, since that is what sets it apart.
 */
const displayUrl = (url: string, withinDomain?: string) => {
  const bare = url.replace(/^https?:\/\//i, "").replace(/^([^/]+)\/$/, "$1");
  if (!withinDomain) return bare;
  if (bare === withinDomain) return "/";
  return bare.startsWith(`${withinDomain}/`) ? bare.slice(withinDomain.length) : bare;
};

const FAVICON_TONE = "bg-black/[0.05] text-text-secondary dark:bg-white/[0.08]";

/**
 * Where visitors leave to, and from which pages.
 *
 * Grouped by destination domain first (as Matomo's Outlinks report does),
 * because a site links to a handful of hosts many times and a list of full
 * URLs buries that. Clicking a domain filters the dashboard to sessions that
 * clicked out to it and drills this tab into that domain's URLs, the way the
 * Browsers tab drills into versions; clicking a URL filters to it. The Pages
 * tab answers the other half of the question, which pages send people away,
 * and narrows to the filtered destination once one is set. The card, like
 * every card, honours the period and every other filter, so "which sources
 * bring visitors who click through to the store" is one filter plus a glance.
 *
 * Counts come from the tracker's `Outbound Link: Click` event, sent only
 * when `data-outbound-links="true"` is on the script tag, so the empty state
 * says how to switch it on rather than reading as "nobody clicks anything".
 */
export default function OutboundLinksCard({
  scope,
  siteDomain,
  detailsHref,
}: {
  scope: AnalyticsScope;
  siteDomain?: string;
  /** The Outbound links page, linked from the card header. */
  detailsHref?: string;
}) {
  const [activeTab, setActiveTab] = useState("destinations");
  const [open, setOpen] = useState(false);

  const { filters, hasFilters, setFilter } = useFilters();
  const domainFiltered = filters.outbound_domain?.op === "is";
  const urlFiltered = filters.outbound_url?.op === "is";

  // Once a domain is filtered the Destinations tab shows that domain's URLs;
  // once a URL is filtered it shows that one URL, which is the end of the road.
  const destinationsBy: OutboundGroup = domainFiltered || urlFiltered ? "url" : "domain";
  const by: OutboundGroup = activeTab === "pages" ? "page" : destinationsBy;

  const summary = useOutboundLinks(scope, by, { limit: 7 });
  const modal = useOutboundLinks(scope, by, { limit: 100, enabled: open });

  const renderName = (row: OutboundRow) => {
    if (by === "domain") {
      if (!row.name) return "(unknown)";
      return (
        <span className="flex items-center gap-2">
          <SiteFavicon domain={row.name} tone={FAVICON_TONE} size="sm" />
          <span className="truncate">{row.name}</span>
        </span>
      );
    }
    if (by === "url") {
      return (
        <span className="truncate" title={row.name}>
          {displayUrl(row.name, domainFiltered ? filters.outbound_domain?.value : undefined)}
        </span>
      );
    }
    return row.name || "(none)";
  };

  const columnsFor = (view: "summary" | "modal"): Column<OutboundRow>[] => {
    const columns: Column<OutboundRow>[] = [
      {
        key: "name",
        label: by === "domain" ? "Domain" : by === "url" ? "Link" : "Page",
        className: "flex-1 truncate pr-2",
        render: renderName,
      },
      {
        key: "visitors",
        label: "Visitors",
        className: view === "summary" ? "w-20 text-right" : "w-16 text-right",
        render: (row) => formatCount(row.visitors),
      },
      {
        key: "clicks",
        label: "Clicks",
        className: view === "summary" ? "w-16 text-right" : "w-16 text-right",
        render: (row) => formatCount(row.clicks),
      },
    ];

    if (view === "modal") {
      // Click-through rate over every visitor in the period, the same
      // denominator as a goal's conversion rate.
      columns.push({
        key: "conversion_rate",
        label: "CTR",
        className: "w-16 text-right",
        render: (row) => formatPercent(row.conversion_rate),
      });
    }

    return columns;
  };

  const handleRowClick = (row: OutboundRow) => {
    if (!row.name) return;
    if (by === "domain") setFilter("outbound_domain", row.name);
    else if (by === "url") setFilter("outbound_url", row.name);
    else setFilter("page", row.name);
    setOpen(false);
  };
  // A single filtered URL has nowhere further to drill.
  const rowClick = by === "url" && urlFiltered ? undefined : handleRowClick;

  const rows = summary.data?.data ?? [];
  const nothingTracked = !summary.isLoading && !summary.isError && rows.length === 0 && !hasFilters;

  const emptyState = () => (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-1 px-4 text-center">
      <p className="text-[13px] text-text-muted">No outbound link clicks in this period.</p>
      <p className="text-[13px] text-text-muted">
        Counting them needs <code className="text-[12px]">data-outbound-links="true"</code> on the
        script tag
        {siteDomain ? (
          <>
            , under{" "}
            <Link to={`/sites/${siteDomain}/settings`} className="text-brand-ink hover:underline">
              site settings
            </Link>
          </>
        ) : null}
        .
      </p>
    </div>
  );

  const tab = (key: string, label: string, modalTitle: string): TabConfig<OutboundRow> => {
    const isActive = key === activeTab;
    return {
      key,
      label,
      data: isActive ? rows : [],
      isLoading: isActive ? summary.isLoading : false,
      error: isActive ? summary.isError : false,
      onRetry: isActive ? () => summary.refetch() : undefined,
      modalData: isActive ? (modal.data?.data ?? []) : [],
      modalLoading: isActive ? modal.isLoading : false,
      viewType: "list",
      modalTitle,
      columns: columnsFor(open ? "modal" : "summary"),
      onRowClick: isActive ? rowClick : undefined,
      renderCard: isActive && nothingTracked ? emptyState : undefined,
    };
  };

  const destinationsTitle =
    by === "url"
      ? domainFiltered
        ? `Links to ${filters.outbound_domain?.value}`
        : "Outbound link"
      : "All outbound domains";

  const tabs: TabConfig<OutboundRow>[] = [
    tab("destinations", "Destinations", destinationsTitle),
    tab("pages", "Pages", "Pages with outbound clicks"),
  ];

  return (
    <AnalyticsCard
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(key) => {
        setActiveTab(key);
        setOpen(false);
      }}
      open={open}
      onModalChange={setOpen}
      action={
        detailsHref ? (
          <Link
            to={detailsHref}
            className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-text-muted transition-colors duration-150 hover:bg-black/[0.04] hover:text-text-primary dark:hover:bg-white/[0.06]"
          >
            View all
            <ArrowUpRight size={13} />
          </Link>
        ) : undefined
      }
    />
  );
}
