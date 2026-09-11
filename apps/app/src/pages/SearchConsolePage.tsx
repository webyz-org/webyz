import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowDown, ArrowUp, Search, TrendingDown, TrendingUp } from "lucide-react";

import PeriodPicker from "../features/dashboard/components/PeriodPicker";
import FeatureGate from "../features/billing/components/FeatureGate";
import RetentionNotice from "../features/billing/components/RetentionNotice";
import { useEntitlements } from "../features/billing/hooks/useEntitlements";
import { useDebouncedValue } from "../features/pages/hooks/usePages";
import {
  isGscStateError,
  useConnectGsc,
  useGscSearch,
  useGscStatus,
} from "../features/search-console/hooks/useSearchConsole";
import { useSiteByDomain } from "../features/websites/hooks/useWebsite";
import { usePeriod } from "../shared/hooks/usePeriod";
import { formatCount } from "../shared/lib/format";
import type {
  GscDimension,
  GscSortKey,
  GscTotals,
} from "../features/search-console/types";

const DIMENSIONS: Array<{ key: GscDimension; label: string; column: string }> = [
  { key: "query", label: "Queries", column: "Query" },
  { key: "page", label: "Pages", column: "Page" },
  { key: "country", label: "Countries", column: "Country" },
  { key: "device", label: "Devices", column: "Device" },
];

const SORTS: GscSortKey[] = ["clicks", "impressions", "ctr", "position"];
const DEFAULT_LIMIT = 25;

/** GSC devices arrive as DESKTOP/MOBILE/TABLET; countries as alpha-3 codes. */
const formatKey = (key: string, dimension: GscDimension) => {
  if (dimension === "device")
    return key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
  if (dimension === "country") return key.toUpperCase();
  return key;
};

const CenteredCard = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-xl border border-border bg-surface p-10 text-center">
    {children}
  </div>
);

/**
 * Change vs the previous equal-length period. Clicks and impressions compare
 * as percentages; CTR and position as absolute deltas (points), because a
 * percent-of-a-percent reads as noise. For position, lower is better.
 */
const ChangeBadge = ({
  metric,
  current,
  previous,
}: {
  metric: GscSortKey;
  current: number;
  previous: number;
}) => {
  if (previous === 0 && current === 0) return null;

  let delta: number;
  let text: string;
  if (metric === "clicks" || metric === "impressions") {
    if (previous === 0) return <span className="text-xs font-medium text-success">new</span>;
    delta = ((current - previous) / previous) * 100;
    text = `${Math.abs(delta).toFixed(1)}%`;
  } else {
    if (previous === 0) return null;
    delta = current - previous;
    text = Math.abs(delta).toFixed(1);
  }

  if (Math.abs(delta) < 0.05) return null;
  const up = delta > 0;
  const good = metric === "position" ? !up : up;

  return (
    <span
      className={
        "flex items-center gap-0.5 text-xs " +
        (good ? "text-success" : "text-danger")
      }
    >
      {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {text}
    </span>
  );
};

export default function SearchConsolePage() {
  const { domain } = useParams<{ domain: string }>();
  const { site, isLoading: siteLoading, notFound } = useSiteByDomain(domain);

  const [searchParams, setSearchParams] = useSearchParams();
  const { period, from, to, setPeriod } = usePeriod();
  const tabParam = searchParams.get("tab") as GscDimension | null;
  const dimension = DIMENSIONS.some((d) => d.key === tabParam)
    ? (tabParam as GscDimension)
    : "query";
  const sortParam = searchParams.get("sort") as GscSortKey | null;
  const sort = sortParam && SORTS.includes(sortParam) ? sortParam : "clicks";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const [searchInput, setSearchInput] = useState(searchParams.get("q") ?? "");
  const search = useDebouncedValue(searchInput.trim());

  const setParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    setSearchParams(params, { replace: true });
  };

  const urlSearch = searchParams.get("q") ?? "";
  useEffect(() => {
    if (search !== urlSearch) setParams({ q: search, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Only ask the API about the connection when the plan includes the feature;
  // otherwise the request is a guaranteed 403 and the gate explains instead.
  const { hasFeature, isLoading: planLoading } = useEntitlements();
  const status = useGscStatus(hasFeature("search_console") ? site?.id : undefined);
  const connect = useConnectGsc(site?.id ?? "");
  const ready = Boolean(
    status.data?.configured && status.data.connected && status.data.property,
  );

  const result = useGscSearch(ready ? site?.id : undefined, {
    period,
    from,
    to,
    dimension,
    search: search || undefined,
    sort,
    order,
    page,
    limit: DEFAULT_LIMIT,
  });

  if (siteLoading || planLoading || (site && hasFeature("search_console") && status.isLoading)) {
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

  const settingsHref = `/sites/${site.domain}/settings?section=integrations`;
  const reauthNeeded =
    isGscStateError(result.error) && result.error.code === "GSC_REAUTH_REQUIRED";

  const dimensionMeta = DIMENSIONS.find((d) => d.key === dimension)!;
  const data = result.data;
  const meta = data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total_items / meta.limit)) : 1;

  const summaryCells: Array<{
    label: string;
    metric: GscSortKey;
    format: (v: number) => string;
  }> = [
    { label: "Clicks", metric: "clicks", format: formatCount },
    { label: "Impressions", metric: "impressions", format: formatCount },
    { label: "Avg. CTR", metric: "ctr", format: (v) => `${v.toFixed(1)}%` },
    { label: "Avg. position", metric: "position", format: (v) => v.toFixed(1) },
  ];

  const onSort = (key: GscSortKey) => {
    if (key === sort) {
      setParams({ order: order === "desc" ? "asc" : "desc", page: null });
    } else {
      // Position starts ascending because position 1 is the best result.
      setParams({
        sort: key,
        order: key === "position" ? "asc" : "desc",
        page: null,
      });
    }
  };

  return (
    <div className="mx-auto max-w-[1280px] px-4 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <h1 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
            {site.name} · Search
          </h1>
          <p className="mt-0.5 text-xs text-text-muted">
            Google Search performance from Search Console. Google's data lags
            by about two days.
          </p>
        </div>

        <PeriodPicker value={period} from={from} to={to} onChange={setPeriod} />
      </div>

      <FeatureGate
        feature="search_console"
        title="Google Search Console"
        description="See the search terms, clicks, impressions and rankings Google reports for your site."
      >
      <RetentionNotice period={period} from={from} />
      {!status.data?.configured ? (
        <CenteredCard>
          <h2 className="text-sm font-semibold">Search Console not available</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">
            This server has no Google OAuth credentials configured, so the
            Search Console integration is disabled.
          </p>
        </CenteredCard>
      ) : !status.data.connected ? (
        <CenteredCard>
          <h2 className="text-sm font-semibold">
            Connect Google Search Console
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">
            See the exact search terms, clicks, impressions and rankings Google
            reports for {site.domain}.
          </p>
          <button
            type="button"
            onClick={() => connect.mutate()}
            disabled={connect.isPending}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {connect.isPending ? "Redirecting..." : "Connect Search Console"}
          </button>
        </CenteredCard>
      ) : !status.data.property ? (
        <CenteredCard>
          <h2 className="text-sm font-semibold">Pick a property</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">
            Your Google account is connected; choose which Search Console
            property feeds this site.
          </p>
          <Link
            to={settingsHref}
            className="mt-3 inline-block text-sm text-primary hover:underline"
          >
            Choose in site settings
          </Link>
        </CenteredCard>
      ) : reauthNeeded ? (
        <CenteredCard>
          <h2 className="text-sm font-semibold">Reconnect Search Console</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">
            Google access for this site expired or was revoked.
          </p>
          <button
            type="button"
            onClick={() => connect.mutate()}
            disabled={connect.isPending}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {connect.isPending ? "Redirecting..." : "Reconnect"}
          </button>
        </CenteredCard>
      ) : result.isError ? (
        <CenteredCard>
          <p className="text-sm text-text-secondary">
            Unable to load Search Console data.
          </p>
          <button
            type="button"
            onClick={() => result.refetch()}
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
          >
            Retry
          </button>
        </CenteredCard>
      ) : (
        <>
          {/* ── Summary ────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
            {summaryCells.map((cell) => (
              <div key={cell.label} className="bg-surface p-4">
                <span className="text-xs uppercase tracking-wide text-text-muted">
                  {cell.label}
                </span>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  {result.isLoading && !data ? (
                    <div className="h-6 w-14 animate-pulse rounded bg-black/5 dark:bg-white/10" />
                  ) : (
                    <>
                      <span className="text-xl font-semibold">
                        {cell.format((data?.summary as GscTotals)?.[cell.metric] ?? 0)}
                      </span>
                      {data && (
                        <ChangeBadge
                          metric={cell.metric}
                          current={data.summary[cell.metric]}
                          previous={data.previous[cell.metric]}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── Controls ───────────────────────────────────────────────────── */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div
              className="flex overflow-hidden rounded-md border border-border"
              role="group"
              aria-label="Search dimension"
            >
              {DIMENSIONS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() =>
                    setParams({
                      tab: d.key === "query" ? null : d.key,
                      page: null,
                    })
                  }
                  aria-pressed={dimension === d.key}
                  className={
                    "px-3 py-2 text-sm " +
                    (dimension === d.key
                      ? "bg-primary font-medium text-primary-foreground"
                      : "hover:bg-black/[0.03] dark:hover:bg-white/[0.05]")
                  }
                >
                  {d.label}
                </button>
              ))}
            </div>

            <label className="relative block w-full max-w-72">
              <span className="sr-only">Filter {dimensionMeta.label.toLowerCase()}</span>
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
              />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={`Filter ${dimensionMeta.label.toLowerCase()}...`}
                className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm outline-none placeholder:text-text-muted focus:border-primary"
              />
            </label>
          </div>

          {/* ── Table ──────────────────────────────────────────────────────── */}
          <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                    <th scope="col" className="px-4 py-3 font-medium">
                      {dimensionMeta.column}
                    </th>
                    {SORTS.map((key) => {
                      const active = key === sort;
                      return (
                        <th
                          key={key}
                          scope="col"
                          aria-sort={
                            active
                              ? order === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                          className="px-4 py-3 text-right font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => onSort(key)}
                            className={
                              "inline-flex items-center gap-1 uppercase tracking-wide hover:text-text-primary " +
                              (active ? "text-text-primary" : "")
                            }
                            aria-label={`Sort by ${key}`}
                          >
                            {key === "ctr"
                              ? "CTR"
                              : key === "position"
                                ? "Position"
                                : key.charAt(0).toUpperCase() + key.slice(1)}
                            {active &&
                              (order === "asc" ? (
                                <ArrowUp size={12} />
                              ) : (
                                <ArrowDown size={12} />
                              ))}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {result.isLoading && !data ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/60">
                        {Array.from({ length: 5 }).map((_, j) => (
                          <td key={j} className="px-4 py-3.5">
                            <div className="h-3.5 w-full max-w-32 animate-pulse rounded bg-black/5 dark:bg-white/10" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : !data?.results.length ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-text-muted">
                        {search
                          ? `Nothing matches “${search}”.`
                          : "No search data for this period. Google's data lags by about two days, and new properties can take longer."}
                      </td>
                    </tr>
                  ) : (
                    data.results.map((row) => (
                      <tr
                        key={row.key}
                        className="border-b border-border/60 last:border-b-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.04]"
                      >
                        <td className="max-w-96 truncate px-4 py-2.5 font-medium" title={row.key}>
                          {formatKey(row.key, dimension)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatCount(row.clicks)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatCount(row.impressions)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {row.ctr.toFixed(1)}%
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {row.position.toFixed(1)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {meta && meta.total_items > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-text-muted">
                <span>
                  {meta.total_items} {dimensionMeta.label.toLowerCase()}
                  {data?.truncated ? " (top 1,000 from Google)" : ""}
                  {data ? ` · ${data.start_date} to ${data.end_date}` : ""}
                </span>

                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setParams({ page: String(page - 1) })}
                      disabled={page <= 1}
                      className="rounded-md border border-border px-2.5 py-1 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <span className="tabular-nums">
                      {meta.page} / {totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setParams({ page: String(page + 1) })}
                      disabled={!meta.has_more}
                      className="rounded-md border border-border px-2.5 py-1 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      </FeatureGate>

      <div className="h-10" />
    </div>
  );
}
