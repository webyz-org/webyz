import { useState } from "react";

import { Button } from "../../../shared/components/ui/button";
import { Card, CardContent } from "../../../shared/components/ui/card";
import { Input } from "../../../shared/components/ui/input";
import { formatCount, formatMoney } from "../../../shared/lib/format";
import { useSetSpendCap } from "../hooks/useBilling";
import type { UsageSummary } from "../types";

/**
 * Spending protection. Reads as a promise, not a meter: what you pay, what is
 * included, how much more you could pay at most, and where the ceiling sits.
 */
export default function SpendCapCard({ summary }: { summary: UsageSummary }) {
  const cap = summary.spendCap;
  const usage = summary.usage;
  const save = useSetSpendCap();
  const [draft, setDraft] = useState<string | null>(null);

  if (!cap.applies || cap.capCents === null) return null;

  const capDollars = (cap.capCents / 100).toFixed(2);
  const value = draft ?? capDollars;
  const draftCents = Math.round(Number(value) * 100);
  const changed = draft !== null && draftCents !== cap.capCents;
  const belowMin = cap.minCents !== null && draftCents < cap.minCents;
  const aboveMax = cap.maxCents !== null && draftCents > cap.maxCents;
  const invalid = Number.isNaN(draftCents) || belowMin || aboveMax;

  const state = usage.capReached ? "reached" : usage.capApproaching ? "approaching" : usage.overageEvents > 0 ? "overage" : "safe";
  const tone =
    state === "reached" ? "border-danger" : state === "approaching" ? "border-warning" : "border-border";

  return (
    <Card className={tone}>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">Spending protection</h2>
          <span className="text-sm text-text-secondary">
            {state === "reached" && "Cap reached, tracking paused"}
            {state === "approaching" && "Approaching your cap"}
            {state === "overage" && "Paying for extra events"}
            {state === "safe" && "Within included usage"}
          </span>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-text-muted">This period so far</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatMoney(usage.currentBillCents)}</dd>
            <dd className="text-xs text-text-muted">
              {summary.base.cycle === "YEARLY"
                ? `${formatMoney(cap.monthlyBaseCents)} monthly share of your annual plan plus ${formatMoney(usage.overageCents)} extra usage`
                : `${formatMoney(cap.monthlyBaseCents)} plan plus ${formatMoney(usage.overageCents)} extra usage`}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted">Most you can be charged</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatMoney(cap.capCents)}</dd>
            <dd className="text-xs text-text-muted">
              {usage.capRemainingCents !== null && usage.capRemainingCents > 0
                ? `${formatMoney(usage.capRemainingCents)} of protection left`
                : "No headroom left this period"}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted">Extra events so far</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatCount(usage.overageEvents)}</dd>
            <dd className="text-xs text-text-muted">
              {formatMoney(summary.plan.overagePricePer1k ?? 0)} per 1,000 beyond {formatCount(usage.includedEvents)} included
            </dd>
          </div>
        </dl>

        <div className="h-2 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
          <div
            className={
              "h-full rounded-full " +
              (state === "reached" ? "bg-danger" : state === "approaching" ? "bg-warning" : "bg-brand")
            }
            style={{ width: `${Math.min(100, Math.max(2, (usage.currentBillCents / cap.capCents) * 100))}%` }}
          />
        </div>

        {state === "reached" && (
          <p className="text-sm text-danger">
            Your cap of {formatMoney(cap.capCents)} was reached, so tracking is paused. Nothing is billed above it. Raise the
            cap to resume now, or wait for the period to reset
            {summary.period.end ? ` on ${new Date(summary.period.end).toLocaleDateString()}` : ""}.
          </p>
        )}

        {cap.pendingCents !== null && (
          <p className="rounded-md bg-black/[0.04] px-3 py-2 text-sm text-text-secondary dark:bg-white/[0.06]">
            Your new cap of {formatMoney(cap.pendingCents)} starts with the next period. This period already cost more than
            that, so the current cap of {formatMoney(cap.capCents)} stays until then.
          </p>
        )}

        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid && changed) save.mutate(draftCents, { onSuccess: () => setDraft(null) });
          }}
        >
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">Monthly spending cap (USD)</span>
            <Input
              type="number"
              inputMode="decimal"
              min={cap.minCents !== null ? cap.minCents / 100 : 0}
              step="1"
              value={value}
              onChange={(e) => setDraft(e.target.value)}
              className="w-40 tabular-nums"
            />
          </label>
          <Button type="submit" disabled={!changed || invalid || save.isPending}>
            {save.isPending ? "Saving..." : "Save cap"}
          </Button>
          {cap.isDefault && !changed && (
            <span className="text-xs text-text-muted">Plan default. Minimum {formatMoney(cap.minCents ?? 0)}.</span>
          )}
          {belowMin && (
            <span className="text-xs text-danger">Cannot be below your plan price of {formatMoney(cap.minCents ?? 0)}.</span>
          )}
          {aboveMax && cap.maxCents !== null && (
            <span className="text-xs text-danger">Cannot be above {formatMoney(cap.maxCents)}.</span>
          )}
        </form>

        {save.data && <p className="text-sm text-text-secondary">{save.data.message}</p>}
        {save.error && <p className="text-sm text-danger">{(save.error as { message?: string }).message}</p>}
      </CardContent>
    </Card>
  );
}
