import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowLeft, Route } from "lucide-react";
import { Line } from "react-chartjs-2";
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";

import PeriodPicker from "../features/dashboard/components/PeriodPicker";
import { useRealtime } from "../features/dashboard/hooks/useDashboard";
import { usePageDetail } from "../features/pages/hooks/usePages";
import { formatBucketLabel } from "../features/pages/lib/format";
import { useSiteByDomain } from "../features/websites/hooks/useWebsite";
import { periodQuery, usePeriod } from "../shared/hooks/usePeriod";
import { periodLabel } from "../config/periods";
import BreakdownList from "../shared/components/BreakdownList";
import {
  countryFlag,
  countryName,
  formatCount,
  formatDuration,
  formatPercent,
} from "../shared/lib/format";

ChartJS.register(
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Filler,
);

const SectionCard = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className="rounded-xl border border-border bg-surface p-4">
    <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
      {title}
    </h2>
    <div className="mt-3">{children}</div>
  </section>
);


export default function PageDetailPage() {
  const { domain } = useParams<{ domain: string }>();
  const { site, isLoading: siteLoading, notFound } = useSiteByDomain(domain);

  const [searchParams] = useSearchParams();
  const { period, from, to, setPeriod } = usePeriod();
  const path = searchParams.get("path") ?? "";

  const scope = { siteId: site?.id ?? "", period, from, to };
  const detail = usePageDetail(scope, path || undefined);

  // Best effort: the realtime snapshot's top pages carry visitors-per-path for
  // the last few minutes. No page-filtered realtime endpoint exists, so the
  // badge links to the Realtime page unfiltered.
  const realtime = useRealtime(site?.id);
  const liveVisitors =
    realtime.data?.top_pages.find((p) => p.name === path)?.visitors ?? 0;

  const stats = detail.data?.stats;
  const trend = detail.data?.trend;

  const chartData = useMemo(
    () => ({
      labels: (trend?.labels ?? []).map((l) =>
        formatBucketLabel(l, trend?.interval ?? "day"),
      ),
      datasets: [
        {
          label: "Pageviews",
          data: trend?.plot ?? [],
          borderColor: "#4f75fe",
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.35,
          fill: true,
          backgroundColor: (context: {
            chart: { ctx: CanvasRenderingContext2D };
          }) => {
            const gradient = context.chart.ctx.createLinearGradient(0, 0, 0, 240);
            gradient.addColorStop(0, "rgba(63,154,168,0.35)");
            gradient.addColorStop(1, "rgba(63,154,168,0.02)");
            return gradient;
          },
        },
      ],
    }),
    [trend],
  );

  const chartOptions = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index" as const, intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item: TooltipItem<"line">) => ` ${item.parsed.y ?? 0} views`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: "#f0ece7" },
          ticks: { precision: 0 },
        },
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 24 } },
      },
    }),
    [],
  );

  if (siteLoading) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 md:px-6 py-10">
        <div className="h-24 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />
      </div>
    );
  }

  if (notFound || !site || !path) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 md:px-6 py-16 text-center">
        <h1 className="text-lg font-semibold">
          {path ? "Site not found" : "No page selected"}
        </h1>
        <Link
          to={site ? `/sites/${site.domain}/pages` : "/sites"}
          className="mt-3 inline-block text-sm text-primary hover:underline"
        >
          {site ? "Back to pages" : "Back to sites"}
        </Link>
      </div>
    );
  }

  const listHref = `/sites/${site.domain}/pages?${periodQuery(period, from, to)}`;
  const title = detail.data?.title || "";

  const metricCards = [
    {
      label: "Pageviews",
      value: formatCount(stats?.views ?? 0),
      extra:
        stats && stats.prev_views > 0 && stats.change !== 0 ? (
          <span
            className={
              "text-xs font-medium " +
              (stats.change > 0 ? "text-success" : "text-danger")
            }
          >
            {stats.change > 0 ? "+" : ""}
            {stats.change}%
          </span>
        ) : null,
    },
    { label: "Sessions", value: formatCount(stats?.sessions ?? 0) },
    { label: "Unique visitors", value: formatCount(stats?.visitors ?? 0) },
    { label: "Bounce rate", value: formatPercent(stats?.bounce_rate ?? 0) },
    { label: "Avg. duration", value: formatDuration(stats?.avg_duration ?? 0) },
  ];

  return (
    <div className="mx-auto max-w-[1280px] px-4 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3 py-4">
        <div className="min-w-0">
          <Link
            to={listHref}
            className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-primary"
          >
            <ArrowLeft size={13} />
            Pages
          </Link>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            {title && (
              <h1 className="truncate text-base font-semibold">{title}</h1>
            )}
            <span
              className={
                "truncate " +
                (title
                  ? "text-sm text-text-muted"
                  : "text-base font-semibold")
              }
            >
              {path}
            </span>

            {liveVisitors > 0 && (
              <Link
                to={`/sites/${site.domain}/realtime`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs text-text-secondary hover:text-text-primary"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                {liveVisitors} {liveVisitors === 1 ? "visitor" : "visitors"} now
              </Link>
            )}
          </div>
          <p className="mt-0.5 text-xs text-text-muted">
            {periodLabel(period, from, to)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={`/sites/${site.domain}/journeys?path=${encodeURIComponent(path)}&${periodQuery(period, from, to)}`}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
          >
            <Route size={14} />
            View journeys
          </Link>

          <PeriodPicker value={period} from={from} to={to} onChange={setPeriod} />
        </div>
      </div>

      {detail.isError ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-secondary">
            Unable to load page analytics.
          </p>
          <button
            type="button"
            onClick={() => detail.refetch()}
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3 lg:grid-cols-5">
            {metricCards.map((card) => (
              <div key={card.label} className="bg-surface p-4">
                <span className="text-xs uppercase tracking-wide text-text-muted">
                  {card.label}
                </span>
                <div className="mt-1 flex items-baseline gap-2">
                  {detail.isLoading && !detail.data ? (
                    <div className="h-6 w-14 animate-pulse rounded bg-black/5 dark:bg-white/10" />
                  ) : (
                    <>
                      <span className="text-xl font-semibold">{card.value}</span>
                      {"extra" in card ? card.extra : null}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-border bg-surface p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Pageviews over time
            </h2>
            <div className="mt-3 h-60 w-full">
              {detail.isLoading && !detail.data ? (
                <div className="h-full w-full animate-pulse rounded bg-black/5 dark:bg-white/10" />
              ) : (
                <Line data={chartData} options={chartOptions} />
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <SectionCard title="Traffic sources">
              <BreakdownList
                rows={detail.data?.sources}
                isLoading={detail.isLoading}
              />
            </SectionCard>

            <SectionCard title="Devices">
              <BreakdownList
                rows={detail.data?.devices}
                isLoading={detail.isLoading}
              />
            </SectionCard>

            <SectionCard title="Countries">
              <BreakdownList
                rows={detail.data?.countries}
                isLoading={detail.isLoading}
                formatName={(code) => (
                  <>
                    {countryFlag(code)} {countryName(code)}
                  </>
                )}
              />
            </SectionCard>

            <SectionCard title="Entry and exit">
              {detail.isLoading && !detail.data ? (
                <div className="h-16 animate-pulse rounded bg-black/5 dark:bg-white/10" />
              ) : (
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-text-muted">Entry sessions</dt>
                    <dd className="mt-0.5 font-semibold tabular-nums">
                      {formatCount(stats?.entry_sessions ?? 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-muted">Exit sessions</dt>
                    <dd className="mt-0.5 font-semibold tabular-nums">
                      {formatCount(stats?.exit_sessions ?? 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-muted">Exit rate</dt>
                    <dd className="mt-0.5 font-semibold tabular-nums">
                      {formatPercent(stats?.exit_rate ?? 0)}
                    </dd>
                  </div>
                </dl>
              )}
            </SectionCard>

            <SectionCard title="Events on this page">
              {detail.isLoading && !detail.data ? (
                <div className="h-16 animate-pulse rounded bg-black/5 dark:bg-white/10" />
              ) : detail.data?.events.length ? (
                <ul className="space-y-1">
                  {detail.data.events.map((event) => (
                    <li
                      key={event.name}
                      className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm"
                    >
                      <span className="truncate">{event.name}</span>
                      <span className="shrink-0 tabular-nums text-text-secondary">
                        {formatCount(event.total)}
                        <span className="ml-2 text-xs text-text-muted">
                          {formatCount(event.visitors)}{" "}
                          {event.visitors === 1 ? "visitor" : "visitors"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-muted">
                  No custom events fired on this page in this period.
                </p>
              )}
            </SectionCard>
          </div>
        </>
      )}

      <div className="h-10" />
    </div>
  );
}
