import { useState } from "react";
import { Link } from "react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Card, CardContent } from "../../../shared/components/ui/card";
import FunnelBuilder from "./FunnelBuilder";
import {
  useCreateFunnel,
  useDeleteFunnel,
  useFunnels,
  useUpdateFunnel,
} from "../hooks/useConversionsFeature";
import {
  useBreakdown,
  useCustomEvents,
} from "../../dashboard/hooks/useDashboard";

/** Steps summarized as "a -> b -> c" for the list rows. */
const stepsSummary = (steps: Array<{ label: string; eventName: string | null; pagePath: string | null }>) =>
  steps
    .map((s) => s.label || s.eventName || s.pagePath || "")
    .join(" -> ");

/**
 * Funnel management: the same builder the Conversions page uses, so a funnel
 * can be created from either place. Analysis lives on the Conversions page.
 */
export default function FunnelSettings({
  siteId,
  domain,
}: {
  siteId: string;
  domain: string;
}) {
  const funnels = useFunnels(siteId || undefined);
  const createFunnel = useCreateFunnel(siteId);
  const updateFunnel = useUpdateFunnel(siteId);
  const deleteFunnel = useDeleteFunnel(siteId);

  const [editing, setEditing] = useState<"closed" | "create" | string>("closed");
  const builderOpen = editing !== "closed";
  const editingFunnel =
    editing !== "closed" && editing !== "create"
      ? funnels.data?.find((f) => f.id === editing)
      : undefined;

  // Step suggestions from data the site has actually recorded, fetched only
  // while the builder is open.
  const scope = { siteId, period: "last_28_days" };
  const pageSuggestions = useBreakdown(scope, "pages", {
    limit: 50,
    enabled: builderOpen,
  });
  const eventSuggestions = useCustomEvents(scope, builderOpen);

  const saveError = (createFunnel.error ?? updateFunnel.error) as
    | { message?: string }
    | null;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <h2 className="font-medium">Funnels</h2>
          <p className="text-sm text-text-muted">
            An ordered sequence of 2-8 pages or events. Drop-off analysis lives
            on the{" "}
            <Link
              to={`/sites/${domain}/conversions?tab=funnels`}
              className="text-primary hover:underline"
            >
              Conversions page
            </Link>
            .
          </p>
        </div>

        {funnels.data?.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {funnels.data.map((funnel) => (
              <li
                key={funnel.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{funnel.name}</p>
                  <p className="truncate text-xs text-text-muted">
                    {stepsSummary(funnel.steps)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => setEditing(funnel.id)}
                    className="rounded p-1.5 text-text-muted hover:text-text-primary"
                    aria-label={`Edit funnel ${funnel.name}`}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => {
                      if (!window.confirm(`Delete funnel "${funnel.name}"?`)) return;
                      deleteFunnel.mutate(funnel.id);
                    }}
                    disabled={deleteFunnel.isPending}
                    className="rounded p-1.5 text-text-muted hover:text-danger"
                    aria-label={`Delete funnel ${funnel.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">No funnels yet.</p>
        )}

        {builderOpen ? (
          <div className="rounded-lg border border-border p-3">
            <h3 className="mb-3 text-sm font-semibold">
              {editingFunnel ? "Edit funnel" : "New funnel"}
            </h3>
            <FunnelBuilder
              key={editing}
              funnel={editingFunnel}
              pageSuggestions={pageSuggestions.data?.data.map((r) => r.name) ?? []}
              eventSuggestions={eventSuggestions.data?.map((e) => e.name) ?? []}
              saving={createFunnel.isPending || updateFunnel.isPending}
              error={saveError?.message}
              onCancel={() => setEditing("closed")}
              onSave={(input) => {
                if (editingFunnel) {
                  updateFunnel.mutate(
                    { funnelId: editingFunnel.id, input },
                    { onSuccess: () => setEditing("closed") },
                  );
                } else {
                  createFunnel.mutate(input, {
                    onSuccess: () => setEditing("closed"),
                  });
                }
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing("create")}
            className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary"
          >
            <Plus size={14} />
            New funnel
          </button>
        )}
      </CardContent>
    </Card>
  );
}
