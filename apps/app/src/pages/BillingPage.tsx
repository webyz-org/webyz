import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { Button } from "../shared/components/ui/button";
import { Card, CardContent } from "../shared/components/ui/card";
import {
  useBillingPortal,
  useCancelPendingChange,
  useCheckout,
  useInvoices,
  usePlans,
  useResumeSubscription,
  useUsageSummary,
} from "../features/billing/hooks/useBilling";
import TrialCard from "../features/billing/components/TrialCard";
import SitesCard from "../features/billing/components/SitesCard";
import SpendCapCard from "../features/billing/components/SpendCapCard";
import PlanChangeDialog from "../features/billing/components/PlanChangeDialog";
import CancelDialog from "../features/billing/components/CancelDialog";
import PlanGrid from "../features/billing/components/PlanGrid";
import type { Plan, UsageSummary } from "../features/billing/types";
import { formatCount, formatMoney } from "../shared/lib/format";
import { getCheckoutConfigApi, getInvoicePdfApi } from "../features/billing/api";
import { initPaddle } from "../features/billing/paddle";

const longDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : null;

/**
 * The billing page. Everything shown comes from GET /billing/usage, computed
 * server side from the usage ledger; this page renders and asks.
 *
 * Order answers the customer's questions in the order they ask them: what am I
 * on, what am I using, am I paying extra and how much could I pay, then the
 * plans and the paperwork.
 */
export default function BillingPage() {
  const [cycle, setCycle] = useState<"MONTHLY" | "YEARLY">("MONTHLY");
  const [params] = useSearchParams();
  const payment = params.get("payment");
  // Paddle's script is initialised on this page for two reasons: Paddle sends
  // customers here to finish a payment with `_ptxn` in the URL and the script
  // opens that transaction's checkout itself; and Paddle Retain (payment
  // recovery, cancellation flows) identifies the signed-in customer through
  // it. It is only loaded for accounts the provider knows, so a free account
  // fetches nothing from Paddle.
  const pendingTransaction = params.get("_ptxn");
  const [paymentFormError, setPaymentFormError] = useState<string | null>(null);
  useEffect(() => {
    getCheckoutConfigApi()
      .then(({ config, customerId }) => {
        if (pendingTransaction || customerId) return initPaddle(config, customerId);
      })
      .catch((err: { message?: string }) => {
        if (pendingTransaction) setPaymentFormError(err.message ?? "Could not open the payment form.");
      });
  }, [pendingTransaction]);

  const summary = useUsageSummary();
  const plans = usePlans();
  const checkout = useCheckout();
  const portal = useBillingPortal();
  const resume = useResumeSubscription();
  const undoChange = useCancelPendingChange();
  const [changeTarget, setChangeTarget] = useState<{ plan: Plan; billingCycle: "MONTHLY" | "YEARLY" } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const s = summary.data;
  // "Can this subscription be changed at the provider?", not "is this account
  // paying?". Only a provider-backed row can be changed or cancelled; a free
  // row and a local trial have nothing there, so they buy a plan through
  // checkout. Deriving this from access.state got a trial that had used up its
  // allowance wrong: `restriction` outranks everything in deriveAccess, so its
  // state reads RESTRICTED rather than TRIAL, which sent the customer to the
  // plan-change dialog and a 400 from the API at exactly the moment they were
  // trying to pay.
  const canChangePlan = Boolean(s?.subscription?.isProviderBacked);
  // Nothing is purchasable until the payment provider and price ids exist;
  // the API says so per plan, and the page explains instead of failing.
  const nothingForSale = Boolean(plans.data?.length) && !plans.data!.some((p) => p.purchasable);
  const pending = s?.pendingChange ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold">Plan and billing</h1>
        <p className="text-sm text-text-muted">Usage is counted across all of your websites.</p>
      </div>

      {pendingTransaction && !paymentFormError && (
        <p className="rounded-md bg-black/[0.04] px-3 py-2 text-sm text-text-secondary dark:bg-white/[0.06]">
          Opening your payment form...
        </p>
      )}
      {paymentFormError && <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{paymentFormError}</p>}
      {payment === "success" && (
        <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          Payment received. Your plan updates as soon as the payment is confirmed, usually within a few seconds.
        </p>
      )}

      {summary.isLoading && <div className="h-40 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />}
      {summary.error && <p className="text-sm text-danger">{(summary.error as { message?: string }).message}</p>}

      {s && (
        <>
          <TrialCard summary={s} />
          <SitesCard summary={s} />

          {pending && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm">
              <span>
                Moving to <strong>{pending.planName}</strong> ({pending.billingCycle === "YEARLY" ? "yearly" : "monthly"}) on{" "}
                {longDate(pending.effectiveAt)}. Until then nothing changes.
              </span>
              <Button variant="outline" size="sm" onClick={() => undoChange.mutate()} disabled={undoChange.isPending}>
                {undoChange.isPending ? "Undoing..." : "Keep current plan"}
              </Button>
            </div>
          )}

          <PlanCard
            summary={s}
            onManagePayment={() => portal.mutate()}
            managePending={portal.isPending}
            onCancel={() => setCancelOpen(true)}
            onResume={() => resume.mutate()}
            resumePending={resume.isPending}
            error={(portal.error ?? resume.error) as { message?: string } | null}
          />

          <UsageCard summary={s} />

          <SpendCapCard summary={s} />

          <section className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-medium">{canChangePlan ? "Change plan" : "Choose a plan"}</h2>
              <div className="flex items-center gap-2">
                {(["MONTHLY", "YEARLY"] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => setCycle(option)}
                    className={
                      "rounded-full px-4 py-1.5 text-sm " +
                      (cycle === option ? "bg-primary text-text-on-primary" : "border border-border text-text-secondary")
                    }
                  >
                    {option === "MONTHLY" ? "Monthly" : "Yearly"}
                  </button>
                ))}
              </div>
            </div>

            <PlanGrid
              plans={plans.data ?? []}
              loading={plans.isLoading}
              cycle={cycle}
              currentPlanId={s.plan.id}
              currentCycle={s.subscription?.billingCycle ?? "MONTHLY"}
              isPaid={canChangePlan}
              isTrial={Boolean(s?.trial)}
              onChoose={(plan) =>
                canChangePlan
                  ? setChangeTarget({ plan, billingCycle: cycle })
                  : checkout.mutate({ planId: plan.id, billingCycle: cycle })
              }
              busy={checkout.isPending}
            />
            {nothingForSale && (
              <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-text-muted">
                Paid plans are not on sale during the beta. New accounts start with a Growth trial and continue on the
                free plan; we will let you know before purchases open, and nothing is charged until you choose a plan.
              </p>
            )}
            {checkout.error && <p className="text-sm text-danger">{(checkout.error as { message?: string }).message}</p>}
          </section>

          {canChangePlan && <InvoicesCard />}

          <PlanChangeDialog target={changeTarget} onClose={() => setChangeTarget(null)} />
          <CancelDialog open={cancelOpen} onClose={() => setCancelOpen(false)} />
        </>
      )}
    </div>
  );
}

// ── Current plan ─────────────────────────────────────────────────────────────

function PlanCard({
  summary: s,
  onManagePayment,
  managePending,
  onCancel,
  onResume,
  resumePending,
  error,
}: {
  summary: UsageSummary;
  onManagePayment: () => void;
  managePending: boolean;
  onCancel: () => void;
  onResume: () => void;
  resumePending: boolean;
  error: { message?: string } | null;
}) {
  const sub = s.subscription;
  const state = s.access.state;
  const nextBilling = s.base.cycle === "YEARLY" ? s.base.periodEnd : s.period.end;
  const cancelling = Boolean(sub?.cancelAt);
  // The payment and cancel actions all reach the provider, so they belong to
  // accounts that have something there. Gating them on `state !== "TRIAL"`
  // showed them to a trial whose allowance had run out, because a restriction
  // makes the state read RESTRICTED: three buttons that could only fail.
  const providerBacked = Boolean(sub?.isProviderBacked);

  const statusLine = (() => {
    if (state === "TRIAL") return `Trial, ends ${longDate(s.trial?.endsAt ?? null)}`;
    if (state === "FREE") return "Free forever, no card on file";
    if (cancelling) return `Ends ${longDate(sub!.cancelAt)}. Access continues until then.`;
    if (state === "GRACE") return `Payment failed. Please update your card before ${longDate(sub?.graceEndsAt ?? null)}.`;
    if (state === "RESTRICTED") return restrictionLine(s.access.reason, s.trial);
    return `Renews ${longDate(nextBilling)}`;
  })();

  return (
    <Card className={state === "RESTRICTED" ? "border-danger" : state === "GRACE" ? "border-warning" : undefined}>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">
              {s.plan.name} plan
              {providerBacked && !s.plan.isFree && (
                <span className="ml-2 text-sm font-normal text-text-secondary">
                  {formatMoney(s.base.priceCents)} {s.base.cycle === "YEARLY" ? "a year" : "a month"}
                  {s.base.cycle === "YEARLY" && ` (${formatMoney(s.base.monthlyEquivalentCents)} a month)`}
                </span>
              )}
            </h2>
            <p className={"text-sm " + (state === "RESTRICTED" ? "text-danger" : state === "GRACE" ? "text-warning" : "text-text-muted")}>
              {statusLine}
            </p>
          </div>
          {!s.access.ingestAllowed && (
            <span className="rounded bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">Tracking paused</span>
          )}
        </div>

        {providerBacked && !s.plan.isFree && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" onClick={onManagePayment} disabled={managePending}>
              {managePending ? "Opening..." : "Payment method and receipts"}
            </Button>
            {cancelling ? (
              <Button variant="outline" onClick={onResume} disabled={resumePending}>
                {resumePending ? "Resuming..." : "Resume subscription"}
              </Button>
            ) : (
              <Button variant="outline" onClick={onCancel}>
                Cancel subscription
              </Button>
            )}
          </div>
        )}
        {error?.message && <p className="text-sm text-danger">{error.message}</p>}
      </CardContent>
    </Card>
  );
}

const restrictionLine = (reason: string | null, trial: UsageSummary["trial"] = null) => {
  switch (reason) {
    case "FREE_QUOTA":
      // A trial is a single period spanning the whole trial, so there is no
      // reset to wait for: it stays paused until the trial ends, and the free
      // plan that follows opens a fresh period with a much smaller allowance.
      if (trial) {
        return `Trial allowance used up. Choose a plan to resume tracking now, or wait for the trial to end and ${trial.fallbackPlanName}'s smaller allowance to start.`;
      }
      return "Event allowance reached. Tracking resumes when the period resets or you upgrade.";
    case "SPEND_CAP":
      return "Your spending cap was reached. Raise it below to resume tracking now.";
    case "PAYMENT_FAILED":
      return "Tracking is paused until the outstanding invoice is paid.";
    case "TRIAL_ENDED":
      return "Your trial ended. Choose a plan to resume tracking.";
    default:
      return "Tracking is paused.";
  }
};

// ── Usage ────────────────────────────────────────────────────────────────────

function UsageCard({ summary: s }: { summary: UsageSummary }) {
  const u = s.usage;
  const ratio = u.includedEvents > 0 ? Math.min(u.totalEvents / u.includedEvents, 1) : 0;
  const over = u.overageEvents > 0;
  const tone = over ? (u.isPayAsYouGo ? "bg-brand" : "bg-danger") : ratio > 0.8 ? "bg-warning" : "bg-brand";

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">Usage this period</h2>
          <span className="text-sm text-text-muted">
            {longDate(s.period.start)} to {longDate(s.period.end)}, {Math.round(s.period.elapsedPercent)}% elapsed
          </span>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <Stat label="Events used" value={formatCount(u.totalEvents)} sub={`of ${formatCount(u.includedEvents)} included`} />
          <Stat
            label="Used"
            value={u.usageRatio === null ? "n/a" : `${Math.round(Math.min(u.usageRatio, 9.99) * 100)}%`}
            sub={u.remainingIncluded > 0 ? `${formatCount(u.remainingIncluded)} remaining` : "allowance used"}
          />
          <Stat
            label="Extra events"
            value={formatCount(u.overageEvents)}
            sub={u.isPayAsYouGo ? `${formatMoney(u.overageCents)} so far` : over ? "not billed, tracking paused" : "none"}
          />
          <Stat
            label="Projected by period end"
            value={formatCount(u.projectedEvents)}
            sub={
              u.isPayAsYouGo
                ? `about ${formatMoney(u.projectedBillCents)}`
                : u.projectedEvents > u.includedEvents
                  ? "over the allowance"
                  : "within the allowance"
            }
          />
        </dl>

        <div className="h-2 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
          <div className={"h-full rounded-full " + tone} style={{ width: `${Math.max(ratio * 100, 2)}%` }} />
        </div>

        <p className="text-xs text-text-muted">
          {u.isPayAsYouGo
            ? `Beyond ${formatCount(u.includedEvents)} included events you pay ${formatMoney(s.plan.overagePricePer1k ?? 0)} per 1,000, never more than your spending cap.`
            : s.access.state === "TRIAL"
              ? "Trials never bill. At the allowance, tracking pauses until you choose a plan."
              : "The free plan never bills. At the allowance, tracking pauses until the period resets or you upgrade."}
          {u.lastComputedAt && ` Updated ${new Date(u.lastComputedAt).toLocaleTimeString()}.`}
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      <dd className="text-xs text-text-muted">{sub}</dd>
    </div>
  );
}

// ── Invoices ─────────────────────────────────────────────────────────────────

function InvoicesCard() {
  const invoices = useInvoices();
  const list = invoices.data?.invoices ?? [];
  return (
    <Card>
      <CardContent className="space-y-3">
        <h2 className="font-medium">Invoices</h2>
        {invoices.isLoading && <div className="h-10 animate-pulse rounded bg-black/5 dark:bg-white/10" />}
        {invoices.error && <p className="text-sm text-danger">{(invoices.error as { message?: string }).message}</p>}
        {!invoices.isLoading && list.length === 0 && <p className="text-sm text-text-muted">No invoices yet.</p>}
        {list.length > 0 && (
          <ul className="divide-y divide-border text-sm">
            {list.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-text-secondary">
                  {new Date(inv.createdAt).toLocaleDateString()} {inv.number ? `· ${inv.number}` : ""}
                </span>
                <span className="tabular-nums">{formatMoney(inv.totalCents)}</span>
                <span
                  className={
                    "rounded px-2 py-0.5 text-xs " +
                    (inv.status === "paid" || inv.status === "completed"
                      ? "bg-success/10 text-success"
                      : inv.status === "billed" || inv.status === "past_due"
                        ? "bg-warning/10 text-warning"
                        : "bg-black/5 text-text-muted dark:bg-white/10")
                  }
                >
                  {inv.status}
                </span>
                <span className="flex gap-3">
                  {inv.hostedUrl && (
                    <a className="text-brand-ink hover:underline" href={inv.hostedUrl} target="_blank" rel="noreferrer">
                      View
                    </a>
                  )}
                  <InvoicePdfLink invoiceId={inv.id} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The provider's PDF link is short lived, so it is fetched when the customer
 * asks for it and opened straight away rather than stored on the page.
 */
function InvoicePdfLink({ invoiceId }: { invoiceId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "unavailable">("idle");

  const open = async () => {
    setState("loading");
    try {
      const { url } = await getInvoicePdfApi(invoiceId);
      window.open(url, "_blank", "noopener,noreferrer");
      setState("idle");
    } catch {
      setState("unavailable");
    }
  };

  if (state === "unavailable") return <span className="text-text-muted">No PDF yet</span>;
  return (
    <button type="button" className="text-brand-ink hover:underline" onClick={() => void open()} disabled={state === "loading"}>
      {state === "loading" ? "Opening..." : "PDF"}
    </button>
  );
}
