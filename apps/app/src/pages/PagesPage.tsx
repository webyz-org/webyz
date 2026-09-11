import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Search } from "lucide-react";

import PeriodPicker from "../features/dashboard/components/PeriodPicker";
import RetentionNotice from "../features/billing/components/RetentionNotice";
import PagesSummary from "../features/pages/components/PagesSummary";
import PagesTable from "../features/pages/components/PagesTable";
import {
  useDebouncedValue,
  usePages,
} from "../features/pages/hooks/usePages";
import { useSiteByDomain } from "../features/websites/hooks/useWebsite";
import { periodQuery, usePeriod } from "../shared/hooks/usePeriod";
import type {
  PageDisplayMode,
  PagesSortKey,
  PagesSortOrder,
} from "../features/pages/types";

const SORT_KEYS: PagesSortKey[] = [
  "views",
  "sessions",
  "visitors",
  "bounce_rate",
  "duration",
  "trend",
];

const DEFAULT_LIMIT = 25;

/**
 * Pages: "which pages get traffic and how do they perform?"
 *
 * Every control (period, search, sort, page, display mode) lives in the URL so
 * a view is linkable and survives reload; search is debounced and aggregation,
 * sorting and pagination all happen server-side, so large sites never download
 * their whole page list.
 */
export default function PagesPage() {
  const { domain } = useParams<{ domain: string }>();
  const { site, isLoading: siteLoading, notFound } = useSiteByDomain(domain);

  const [searchParams, setSearchParams] = useSearchParams();
  const { period, from, to, setPeriod } = usePeriod();
  const sortParam = searchParams.get("sort") as PagesSortKey | null;
  const sort = sortParam && SORT_KEYS.includes(sortParam) ? sortParam : "views";
  const order: PagesSortOrder =
    searchParams.get("order") === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = [10, 25, 50, 100].includes(Number(searchParams.get("limit")))
    ? Number(searchParams.get("limit"))
    : DEFAULT_LIMIT;
  const mode: PageDisplayMode =
    searchParams.get("mode") === "url" ? "url" : "path";

  // The input is local so typing is instant; the URL and the request follow
  // the debounced value.
  const [searchInput, setSearchInput] = useState(
    searchParams.get("q") ?? "",
  );
  const search = useDebouncedValue(searchInput.trim());

  const setParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    setSearchParams(params, { replace: true });
  };

  // Keep the URL's q in sync with the debounced search, resetting pagination.
  const urlSearch = searchParams.get("q") ?? "";
  useEffect(() => {
    if (search !== urlSearch) setParams({ q: search, page: null });
    // setParams identity changes with searchParams; syncing on search only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const scope = { siteId: site?.id ?? "", period, from, to };
  const pages = usePages(scope, {
    search: search || undefined,
    sort,
    order,
    page,
    limit,
  });

  // A stale ?page= beyond the last page (hand-edited URL, shrunk result set)
  // returns no rows and no pagination to escape from; snap back to page 1.
  const pastEnd =
    pages.data && page > 1 && pages.data.results.length === 0;
  useEffect(() => {
    if (pastEnd) setParams({ page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastEnd]);

  const onSort = (key: PagesSortKey) => {
    if (key === sort) {
      setParams({ order: order === "desc" ? "asc" : "desc", page: null });
    } else {
      // A new column starts at its most useful direction: descending.
      setParams({ sort: key, order: "desc", page: null });
    }
  };

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
        <Link
          to="/sites"
          className="mt-3 inline-block text-sm text-primary hover:underline"
        >
          Back to sites
        </Link>
      </div>
    );
  }

  const hasAnyData = (pages.data?.summary.pageviews ?? 0) > 0;
  const detailHref = (path: string) =>
    `/sites/${site.domain}/pages/detail?path=${encodeURIComponent(path)}&${periodQuery(period, from, to)}`;

  return (
    <div className="mx-auto max-w-[1280px] px-4 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <h1 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
            {site.name} · Pages
          </h1>
          <p className="mt-0.5 text-xs text-text-muted">
            Every tracked page and how it performs. Click a page for its
            detailed view.
          </p>
        </div>

        <PeriodPicker value={period} from={from} to={to} onChange={setPeriod} />
      </div>

      <RetentionNotice period={period} from={from} />

      <PagesSummary summary={pages.data?.summary} isLoading={pages.isLoading} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="relative block w-full max-w-72">
          <span className="sr-only">Search pages</span>
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search pages..."
            className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm outline-none placeholder:text-text-muted focus:border-primary"
          />
        </label>

        <div
          className="flex overflow-hidden rounded-md border border-border"
          role="group"
          aria-label="Page display mode"
        >
          {(["path", "url"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setParams({ mode: m === "path" ? null : m })}
              aria-pressed={mode === m}
              className={
                "px-3 py-2 text-sm " +
                (mode === m
                  ? "bg-primary font-medium text-primary-foreground"
                  : "hover:bg-black/[0.03] dark:hover:bg-white/[0.05]")
              }
            >
              {m === "path" ? "Path" : "URL"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {pages.isError ? (
          <div className="rounded-xl border border-border bg-surface p-8 text-center">
            <p className="text-sm text-text-secondary">
              Unable to load page analytics.
            </p>
            <button
              type="button"
              onClick={() => pages.refetch()}
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
            >
              Retry
            </button>
          </div>
        ) : !pages.isLoading && !hasAnyData ? (
          <div className="rounded-xl border border-border bg-surface p-10 text-center">
            <h2 className="text-sm font-semibold">No pages found</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">
              Pages will appear here once visitors start browsing your website.
            </p>
            <Link
              to={`/sites/${site.domain}/setup`}
              className="mt-3 inline-block text-sm text-primary hover:underline"
            >
              Check your tracker installation
            </Link>
          </div>
        ) : !pages.isLoading && hasAnyData && !pages.data?.results.length ? (
          <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-text-muted">
            No pages match “{search}”.
          </div>
        ) : (
          <PagesTable
            data={pages.data}
            isLoading={pages.isLoading}
            mode={mode}
            domain={site.domain}
            sort={sort}
            order={order}
            onSort={onSort}
            detailHref={detailHref}
            onPageChange={(next) => setParams({ page: String(next) })}
            onLimitChange={(next) =>
              setParams({ limit: String(next), page: null })
            }
          />
        )}
      </div>

      <div className="h-10" />
    </div>
  );
}
