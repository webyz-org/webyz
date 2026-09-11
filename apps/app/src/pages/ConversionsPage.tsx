import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";

import PeriodPicker from "../features/dashboard/components/PeriodPicker";
import FeatureGate from "../features/billing/components/FeatureGate";
import RetentionNotice from "../features/billing/components/RetentionNotice";
import FunnelBuilder from "../features/conversions/components/FunnelBuilder";
import FunnelChart from "../features/conversions/components/FunnelChart";
import GoalDetail from "../features/conversions/components/GoalDetail";
import {
  useCreateFunnel,
  useDeleteFunnel,
  useFunnelAnalysis,
  useFunnels,
  useUpdateFunnel,
} from "../features/conversions/hooks/useConversionsFeature";
import {
  useBreakdown,
  useConversions,
  useCustomEvents,
} from "../features/dashboard/hooks/useDashboard";
import { useSiteByDomain } from "../features/websites/hooks/useWebsite";
import { usePeriod } from "../shared/hooks/usePeriod";
import { formatCount } from "../shared/lib/format";
import type { FunnelMetric } from "../features/conversions/types";

/**
 * Conversions: Goals (what converts and who converts) and Funnels (where
 * people drop off between steps). Goal definitions are managed in site
 * settings; funnels are managed here because building one needs suggestions
 * and space. Every control lives in the URL so views are linkable.
 */
export default function ConversionsPage() {
  const { domain } = useParams<{ domain: string }>();
  const { site, isLoading: siteLoading, notFound } = useSiteByDomain(domain);

  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "funnels" ? "funnels" : "goals";
  const { period, from, to, setPeriod } = usePeriod();
  const selectedGoalId = searchParams.get("goal") ?? undefined;
  const funnelParam = searchParams.get("funnel") ?? undefined;
  const metric: FunnelMetric =
    searchParams.get("metric") === "sessions" ? "sessions" : "visitors";

  const setParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    setSearchParams(params, { replace: true });
  };

  const scope = { siteId: site?.id ?? "", period, from, to };
  const conversions = useConversions(scope, tab === "goals");

  const funnels = useFunnels(tab === "funnels" ? site?.id : undefined);
  const selectedFunnelId =
    funnelParam && funnels.data?.some((f) => f.id === funnelParam)
      ? funnelParam
      : funnels.data?.[0]?.id;
  const selectedFunnel = funnels.data?.find((f) => f.id === selectedFunnelId);
  const analysis = useFunnelAnalysis(
    site?.id,
    selectedFunnelId,
    { period, from, to },
    metric,
  );

  const [builder, setBuilder] = useState<"closed" | "create" | "edit">("closed");
  const createFunnel = useCreateFunnel(site?.id ?? "");
  const updateFunnel = useUpdateFunnel(site?.id ?? "");
  const deleteFunnel = useDeleteFunnel(site?.id ?? "");

  // Step suggestions from data the site has actually recorded; fetched only
  // while the builder is open.
  const builderOpen = builder !== "closed";
  const pageSuggestions = useBreakdown(scope, "pages", {
    limit: 50,
    enabled: builderOpen,
  });
  const eventSuggestions = useCustomEvents(scope, builderOpen);

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

  const goals = conversions.data ?? [];
  const saveError = (createFunnel.error ?? updateFunnel.error) as
    | { message?: string }
    | null;

  return (
    <div className="mx-auto max-w-[1280px] px-4 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <h1 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
            {site.name} · Conversions
          </h1>
          <p className="mt-0.5 text-xs text-text-muted">
            Goal completions and funnel drop-off, from your real events.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex overflow-hidden rounded-md border border-border"
            role="group"
            aria-label="Conversions view"
          >
            {(["goals", "funnels"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setParams({ tab: t === "goals" ? null : t })}
                aria-pressed={tab === t}
                className={
                  "px-3 py-2 text-sm capitalize " +
                  (tab === t
                    ? "bg-primary font-medium text-primary-foreground"
                    : "hover:bg-black/[0.03] dark:hover:bg-white/[0.05]")
                }
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "funnels" && (
            <select
              value={metric}
              onChange={(e) =>
                setParams({
                  metric: e.target.value === "sessions" ? "sessions" : null,
                })
              }
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm outline-none"
              aria-label="Funnel metric"
            >
              <option value="visitors">Visitors</option>
              <option value="sessions">Sessions</option>
            </select>
          )}

          <PeriodPicker value={period} from={from} to={to} onChange={setPeriod} />
        </div>
      </div>

      <RetentionNotice period={period} from={from} />

      {tab === "goals" ? (
        /* ── Goals ──────────────────────────────────────────────────────── */
        <div className="space-y-4">
          {conversions.isLoading ? (
            <div className="h-40 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />
          ) : !goals.length ? (
            <div className="rounded-xl border border-border bg-surface p-10 text-center">
              <h2 className="text-sm font-semibold">No goals yet</h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">
                A goal tracks a custom event or a page visit as a conversion.
              </p>
              <Link
                to={`/sites/${site.domain}/settings?section=goals`}
                className="mt-3 inline-block text-sm text-primary hover:underline"
              >
                Create goals in site settings
              </Link>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                      <th scope="col" className="px-4 py-3 font-medium">Goal</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">Visitors</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">Conversions</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">CR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {goals.map((goal) => {
                      const selected = goal.id === selectedGoalId;
                      return (
                        <tr
                          key={goal.id}
                          className={
                            "border-b border-border/60 last:border-b-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.04] " +
                            (selected ? "bg-primary-soft/30" : "")
                          }
                        >
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              onClick={() =>
                                setParams({ goal: selected ? null : goal.id })
                              }
                              aria-expanded={selected}
                              className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                              <span className="block font-medium">{goal.name}</span>
                              <span className="block text-xs text-text-muted">
                                {goal.event_name
                                  ? `Event: ${goal.event_name}`
                                  : `Page: ${goal.page_path}`}
                              </span>
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {formatCount(goal.visitors)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {formatCount(goal.completions)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                            {goal.conversion_rate}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-border px-4 py-2 text-xs text-text-muted">
                Click a goal for its trend and audience.{" "}
                <Link
                  to={`/sites/${site.domain}/settings?section=goals`}
                  className="text-primary hover:underline"
                >
                  Manage goals
                </Link>
              </div>
            </div>
          )}

          {selectedGoalId && goals.some((g) => g.id === selectedGoalId) && (
            <GoalDetail
              siteId={site.id}
              goalId={selectedGoalId}
              range={{ period, from, to }}
            />
          )}
        </div>
      ) : (
        /* ── Funnels ────────────────────────────────────────────────────── */
        <FeatureGate
          feature="funnels"
          title="Funnels"
          description="Measure how many visitors complete an ordered sequence of pages and events, and where they drop off."
        >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {funnels.data?.map((funnel) => (
              <button
                key={funnel.id}
                type="button"
                onClick={() => {
                  setParams({ funnel: funnel.id });
                  setBuilder("closed");
                }}
                aria-pressed={funnel.id === selectedFunnelId}
                className={
                  "rounded-md border px-3 py-1.5 text-sm " +
                  (funnel.id === selectedFunnelId
                    ? "border-primary bg-primary-soft/40 font-medium"
                    : "border-border hover:bg-black/[0.03] dark:hover:bg-white/[0.05]")
                }
              >
                {funnel.name}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setBuilder("create")}
              className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary"
            >
              <Plus size={14} />
              New funnel
            </button>
          </div>

          {builderOpen && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-3 text-sm font-semibold">
                {builder === "edit" ? "Edit funnel" : "New funnel"}
              </h2>
              <FunnelBuilder
                key={builder === "edit" ? selectedFunnelId : "create"}
                funnel={builder === "edit" ? selectedFunnel : undefined}
                pageSuggestions={
                  pageSuggestions.data?.data.map((r) => r.name) ?? []
                }
                eventSuggestions={
                  eventSuggestions.data?.map((e) => e.name) ?? []
                }
                saving={createFunnel.isPending || updateFunnel.isPending}
                error={saveError?.message}
                onCancel={() => setBuilder("closed")}
                onSave={(input) => {
                  if (builder === "edit" && selectedFunnelId) {
                    updateFunnel.mutate(
                      { funnelId: selectedFunnelId, input },
                      { onSuccess: () => setBuilder("closed") },
                    );
                  } else {
                    createFunnel.mutate(input, {
                      onSuccess: (created) => {
                        setBuilder("closed");
                        setParams({ funnel: created.id });
                      },
                    });
                  }
                }}
              />
            </div>
          )}

          {funnels.isLoading ? (
            <div className="h-64 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />
          ) : !funnels.data?.length ? (
            !builderOpen && (
              <div className="rounded-xl border border-border bg-surface p-10 text-center">
                <h2 className="text-sm font-semibold">No funnels yet</h2>
                <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">
                  A funnel shows how many visitors make it through an ordered
                  sequence of pages and events, and where they drop off.
                </p>
                <button
                  type="button"
                  onClick={() => setBuilder("create")}
                  className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Create your first funnel
                </button>
              </div>
            )
          ) : selectedFunnel ? (
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{selectedFunnel.name}</h2>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setBuilder("edit")}
                    className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                  >
                    <Pencil size={13} />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`Delete funnel "${selectedFunnel.name}"?`)) return;
                      deleteFunnel.mutate(selectedFunnel.id, {
                        onSuccess: () => setParams({ funnel: null }),
                      });
                    }}
                    disabled={deleteFunnel.isPending}
                    className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-danger hover:bg-danger/10"
                  >
                    <Trash2 size={13} />
                    Delete
                  </button>
                </div>
              </div>

              {analysis.isError ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-text-secondary">
                    Unable to load funnel analysis.
                  </p>
                  <button
                    type="button"
                    onClick={() => analysis.refetch()}
                    className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                  >
                    Retry
                  </button>
                </div>
              ) : analysis.isLoading && !analysis.data ? (
                <div className="h-64 animate-pulse rounded bg-black/5 dark:bg-white/10" />
              ) : analysis.data && analysis.data.entered === 0 ? (
                <p className="py-8 text-center text-sm text-text-muted">
                  Nobody entered this funnel in the selected period.
                </p>
              ) : analysis.data ? (
                <FunnelChart analysis={analysis.data} metric={metric} />
              ) : null}
            </div>
          ) : null}
        </div>
        </FeatureGate>
      )}

      <div className="h-10" />
    </div>
  );
}
