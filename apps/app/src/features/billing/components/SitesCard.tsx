import { useState } from "react";

import { Button } from "../../../shared/components/ui/button";
import { Card, CardContent } from "../../../shared/components/ui/card";
import { useWebsites } from "../../websites/hooks/useWebsite";
import { useSetActiveSites } from "../hooks/useBilling";
import type { UsageSummary } from "../types";

const REASONS: Record<string, string> = {
  TRIAL_ENDED: "made inactive when your trial ended",
  PLAN_CHANGE: "made inactive when your plan changed",
  CUSTOMER_CHOICE: "you chose to keep it inactive",
};

/**
 * Shown only when the account has more websites than the plan allows. The
 * customer picks which stay active; the rest keep their history and stop
 * collecting new data. Nothing here deletes.
 */
export default function SitesCard({ summary }: { summary: UsageSummary }) {
  const websites = useWebsites();
  const save = useSetActiveSites();
  const [selected, setSelected] = useState<Set<string> | null>(null);

  if (summary.sites.inactive.length === 0) return null;
  const all = websites.data ?? [];
  const limit = summary.sites.limit;
  const current = selected ?? new Set(all.filter((w) => w.isActive).map((w) => w.id));

  const toggle = (id: string) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else if (next.size < limit) next.add(id);
    setSelected(next);
  };

  return (
    <Card className="border-warning">
      <CardContent className="space-y-3">
        <div>
          <h2 className="font-medium">Choose which websites stay active</h2>
          <p className="text-sm text-text-secondary">
            Your plan allows {limit} active website{limit === 1 ? "" : "s"} and you have {all.length}. Inactive sites keep
            all their history but stop collecting new data. Upgrade to make every site active again.
          </p>
        </div>

        <ul className="divide-y divide-border rounded-md border border-border">
          {all.map((w) => {
            const on = current.has(w.id);
            const inactive = summary.sites.inactive.find((s) => s.id === w.id);
            return (
              <li key={w.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && current.size >= limit}
                    onChange={() => toggle(w.id)}
                    className="h-4 w-4 accent-[var(--brand)]"
                  />
                  <span className={on ? "text-text-primary" : "text-text-secondary"}>{w.domain}</span>
                </label>
                <span className="text-xs text-text-muted">
                  {on ? "active" : inactive?.reason ? REASONS[inactive.reason] ?? "inactive" : "inactive"}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => save.mutate([...current])}
            disabled={save.isPending || selected === null}
          >
            {save.isPending ? "Saving..." : "Save active websites"}
          </Button>
          <span className="text-xs text-text-muted">
            {current.size} of {limit} selected
          </span>
          {save.isSuccess && selected === null && <span className="text-xs text-success">Saved</span>}
          {save.error && <span className="text-xs text-danger">{(save.error as { message?: string }).message}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
