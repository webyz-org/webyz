import { Suspense, lazy, useState } from "react";
import { Link, useParams } from "react-router";
import { Pause, Play } from "lucide-react";

import VisitorList from "../features/realtime/components/VisitorList";
import VisitorDetails from "../features/realtime/components/VisitorDetails";
import ActivityFeed from "../features/realtime/components/ActivityFeed";
import { useRealtimeFeed } from "../features/realtime/useRealtimeFeed";
import { timeAgo } from "../features/realtime/time";
import {
  DEFAULT_REALTIME_WINDOW,
  REALTIME_WINDOWS,
  type RealtimeWindow,
} from "../features/realtime/types";
import { useSiteByDomain } from "../features/websites/hooks/useWebsite";
import { formatCount } from "../shared/lib/format";

// The map chunk carries d3-geo plus the world atlas; nobody pays for it until
// they open this page.
const WorldMap = lazy(
  () => import("../features/realtime/components/WorldMap"),
);

const MapSkeleton = () => (
  <div className="h-full w-full animate-pulse bg-black/[0.03] dark:bg-white/[0.05]" />
);

export default function RealtimePage() {
  const { domain } = useParams<{ domain: string }>();
  const { site, isLoading: siteLoading, notFound } = useSiteByDomain(domain);

  const [mode, setMode] = useState<"globe" | "flat">("globe");
  const [windowMinutes, setWindowMinutes] = useState<RealtimeWindow>(
    DEFAULT_REALTIME_WINDOW,
  );
  const [selectedVisitorId, setSelectedVisitorId] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<"visitors" | "activity">("visitors");

  const feed = useRealtimeFeed(site?.id, windowMinutes);

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

  const markers = [...feed.countryCounts.entries()].map(([country, entry]) => ({
    country,
    count: entry.count,
    active: entry.active,
    lastActiveAgo: timeAgo(feed.now, entry.lastActiveAt),
  }));
  const unknownCount = feed.visitors.filter((v) => !v.country).length;
  const activeCutoff = feed.now - feed.activeMinutes * 60;

  const selectVisitor = (visitorId: string) => {
    setSelectedVisitorId(visitorId);
    const visitor = feed.visitorsById[visitorId];
    setSelectedCountry(visitor?.country || null);
  };

  const selectCountry = (country: string | null) => {
    setSelectedCountry(country);
    setSelectedVisitorId(null);
    setPanelTab("visitors");
  };

  const connection = feed.paused
    ? { dot: "bg-warning", label: "Paused" }
    : feed.status === "live"
      ? { dot: "bg-success", label: "Live" }
      : feed.status === "reconnecting"
        ? { dot: "bg-warning", label: "Reconnecting..." }
        : { dot: "bg-text-muted", label: "Connecting..." };

  const stats = [
    { label: "Active visitors", value: feed.activeCount },
    { label: "Page views", value: feed.pageviews },
    { label: "Events", value: feed.events },
    { label: "Countries", value: feed.countryCounts.size },
  ];

  return (
    <div className="mx-auto max-w-[1280px] px-4 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
              {site.name} · Realtime
            </h1>
            <span className="flex items-center gap-1.5 text-xs text-text-secondary">
              <span className={`relative flex h-2 w-2`} aria-hidden>
                {!feed.paused && feed.status === "live" && (
                  <span
                    className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${connection.dot}`}
                  />
                )}
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${connection.dot}`}
                />
              </span>
              {connection.label}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-text-muted">
            <span className="font-medium text-text-secondary">
              {feed.activeCount} active visitor{feed.activeCount === 1 ? "" : "s"}
            </span>
            {feed.lastUpdatedAt
              ? ` · updated ${timeAgo(feed.now, feed.lastUpdatedAt)}`
              : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex overflow-hidden rounded-md border border-border"
            role="group"
            aria-label="Map style"
          >
            {(["globe", "flat"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={
                  "px-3 py-2 text-sm capitalize " +
                  (mode === m
                    ? "bg-primary font-medium text-primary-foreground"
                    : "hover:bg-black/[0.03] dark:hover:bg-white/[0.05]")
                }
              >
                {m === "flat" ? "Map" : "Globe"}
              </button>
            ))}
          </div>

          <select
            value={windowMinutes}
            onChange={(e) =>
              setWindowMinutes(Number(e.target.value) as RealtimeWindow)
            }
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm outline-none"
            aria-label="Realtime window"
          >
            {REALTIME_WINDOWS.map((w) => (
              <option key={w} value={w}>
                Last {w} min
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={feed.paused ? feed.resume : feed.pause}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
          >
            {feed.paused ? <Play size={14} /> : <Pause size={14} />}
            {feed.paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:h-[calc(100vh-220px)] lg:min-h-[480px] lg:flex-row">
        {/* ── Map ────────────────────────────────────────────────────────── */}
        <div className="relative h-[45vh] min-h-72 flex-1 overflow-hidden rounded-xl border border-border bg-surface lg:h-auto">
          <Suspense fallback={<MapSkeleton />}>
            <WorldMap
              mode={mode}
              markers={markers}
              selectedCountry={selectedCountry}
              onSelectCountry={selectCountry}
            />
          </Suspense>

          <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-border bg-surface/85 px-3 py-1.5 backdrop-blur"
              >
                <p className="text-[10px] uppercase tracking-wide text-text-muted">
                  {stat.label}
                </p>
                <p className="text-sm font-semibold">{formatCount(stat.value)}</p>
              </div>
            ))}
          </div>

          {feed.paused && (
            <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-border bg-surface/90 px-3 py-1 text-xs text-text-secondary backdrop-blur">
              Live updates paused
            </div>
          )}

          {unknownCount > 0 && (
            <p className="absolute bottom-3 left-3 rounded-md bg-surface/85 px-2 py-1 text-xs text-text-muted backdrop-blur">
              {unknownCount} visitor{unknownCount === 1 ? "" : "s"} with unknown
              location
            </p>
          )}

          {feed.isError && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface/70">
              <p className="text-sm text-danger">
                Could not load realtime data. Retrying automatically.
              </p>
            </div>
          )}

          {!feed.isLoading && !feed.isError && feed.visitors.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-xl border border-border bg-surface/90 px-6 py-4 text-center backdrop-blur">
                <p className="font-medium">No active visitors</p>
                <p className="mt-1 text-sm text-text-muted">
                  Visitors will appear here when they start browsing your site.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Panel ─────────────────────────────────────────────────────── */}
        <div className="flex h-105 flex-col overflow-hidden rounded-xl border border-border bg-surface lg:h-auto lg:w-88">
          {selectedVisitorId ? (
            <VisitorDetails
              visitor={feed.visitorsById[selectedVisitorId]}
              siteId={site.id}
              windowMinutes={windowMinutes}
              now={feed.now}
              activeCutoff={activeCutoff}
              onBack={() => setSelectedVisitorId(null)}
            />
          ) : (
            <>
              <div
                className="flex gap-4 border-b border-border px-4 pt-2.5"
                role="tablist"
                aria-label="Realtime panel"
              >
                {(["visitors", "activity"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={panelTab === tab}
                    onClick={() => setPanelTab(tab)}
                    className={
                      "pb-2 text-xs font-medium uppercase tracking-wide " +
                      (panelTab === tab
                        ? "border-b-2 border-primary text-text-primary"
                        : "text-text-muted hover:text-text-secondary")
                    }
                  >
                    {tab === "visitors" ? "Visitors" : "Live activity"}
                  </button>
                ))}
              </div>

              {feed.isLoading ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-12 animate-pulse rounded bg-black/5 dark:bg-white/10" />
                  ))}
                </div>
              ) : panelTab === "visitors" ? (
                <VisitorList
                  visitors={feed.visitors}
                  now={feed.now}
                  activeCutoff={activeCutoff}
                  selectedVisitorId={selectedVisitorId}
                  countryFilter={selectedCountry}
                  onClearCountryFilter={() => setSelectedCountry(null)}
                  onSelect={selectVisitor}
                />
              ) : (
                <ActivityFeed items={feed.feed} now={feed.now} />
              )}
            </>
          )}
        </div>
      </div>

      <div className="h-6" />
    </div>
  );
}
