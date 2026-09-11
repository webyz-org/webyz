import { Check } from "lucide-react";

import { Button } from "../../../shared/components/ui/button";
import { Card, CardContent } from "../../../shared/components/ui/card";
import { formatCount, formatMoney } from "../../../shared/lib/format";
import type { Plan } from "../types";

const FEATURES: { key: keyof Plan["entitlements"]; label: string }[] = [
  { key: "funnels", label: "Funnels" },
  { key: "journeys", label: "User journeys" },
  { key: "search_console", label: "Search Console" },
  { key: "exports", label: "CSV export" },
  { key: "api_access", label: "API access" },
];

/**
 * Plan cards inside the app. Rows come from each plan's entitlements as the
 * API serves them, so the page cannot promise something the backend gates.
 */
export default function PlanGrid({
  plans,
  loading,
  cycle,
  currentPlanId,
  currentCycle,
  isPaid,
  isTrial,
  onChoose,
  busy,
}: {
  plans: Plan[];
  loading: boolean;
  cycle: "MONTHLY" | "YEARLY";
  currentPlanId: string;
  currentCycle: "MONTHLY" | "YEARLY";
  isPaid: boolean;
  /** The account is on a trial of `currentPlanId`: nothing is "current" to buy. */
  isTrial?: boolean;
  onChoose: (plan: Plan) => void;
  busy: boolean;
}) {
  const sorted = [...plans].sort((a, b) => a.sortOrder - b.sortOrder);
  const cols = sorted.length >= 4 ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3";

  return (
    <div className={`grid gap-4 ${cols}`}>
      {loading &&
        Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-72 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />)}

      {sorted.map((plan) => {
        const e = plan.entitlements;
        // A trial is not a purchase: its plan must stay buyable, or the one
        // plan the trialist is already using is the one they cannot subscribe
        // to. Only a paid subscription (or the free plan itself) is "current".
        const isTrialPlan = Boolean(isTrial) && plan.id === currentPlanId;
        const isCurrent = !isTrialPlan && plan.id === currentPlanId && (plan.isFree || currentCycle === cycle);
        const price = cycle === "YEARLY" ? plan.yearlyPrice : plan.monthlyPrice;
        const priceId = cycle === "YEARLY" ? plan.providerPriceYearlyId : plan.providerPriceMonthlyId;
        const purchasable = plan.purchasable && Boolean(priceId);

        return (
          <Card key={plan.id} className={isCurrent ? "border-brand" : undefined}>
            <CardContent className="flex h-full flex-col space-y-3">
              <div>
                <h3 className="flex items-center gap-2 font-semibold">
                  {plan.name}
                  {isTrialPlan && (
                    <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-ink">
                      Your trial
                    </span>
                  )}
                </h3>
                <p className="text-sm text-text-muted">{plan.description}</p>
              </div>

              <div>
                <span className="text-2xl font-semibold tabular-nums">{plan.isFree ? "Free" : formatMoney(price)}</span>
                {!plan.isFree && <span className="text-sm text-text-muted">/{cycle === "YEARLY" ? "year" : "month"}</span>}
                {!plan.isFree && cycle === "YEARLY" && (
                  <p className="text-xs text-text-muted">{formatMoney(Math.round(plan.yearlyPrice / 12))} a month, billed yearly</p>
                )}
              </div>

              <ul className="flex-1 space-y-1.5 text-sm">
                <Row>{formatCount(e.events_per_period)} events / month</Row>
                <Row>{`${e.sites} website${e.sites === 1 ? "" : "s"}`}</Row>
                <Row>{e.retention_days} days of history</Row>
                <Row>
                  {plan.overagePricePer1k === null
                    ? "Pauses at the limit, never a bill"
                    : `${formatMoney(plan.overagePricePer1k)} per extra 1,000 events, capped by you`}
                </Row>
                {FEATURES.filter((f) => e[f.key]).map((f) => (
                  <Row key={f.key}>{f.label}</Row>
                ))}
              </ul>

              {isCurrent ? (
                <Button disabled className="w-full">
                  Current plan
                </Button>
              ) : purchasable ? (
                <Button className="w-full" onClick={() => onChoose(plan)} disabled={busy}>
                  {busy ? "Please wait..." : isPaid ? "Switch to this plan" : isTrialPlan ? "Subscribe" : "Choose plan"}
                </Button>
              ) : (
                <Button disabled variant="outline" className="w-full">
                  {plan.isFree ? (isPaid ? "Cancel to move here" : isTrial ? "After the trial" : "Included") : "Not on sale yet"}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <Check size={15} className="shrink-0 text-brand" />
      <span>{children}</span>
    </li>
  );
}
