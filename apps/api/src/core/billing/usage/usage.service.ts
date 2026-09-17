import type { AppContext } from "../../../lib/context.js";
import { computeUsage, monthlyEquivalentBase, projectPeriodTotal, type UsageComputation } from "./usage-math.js";
import { resolveSpendCap } from "../spend-cap/spend-cap.service.js";
import { LIVE_STATUSES } from "../entitlements/entitlement.service.js";
import { deriveAccess, type Access } from "../state/access-state.js";
import { parseEntitlements, type Entitlements } from "../catalog/entitlements.schema.js";

export type UsageSummary = {
  plan: {
    id: string;
    code: string;
    name: string;
    isFree: boolean;
    overagePricePer1k: number | null;
    /** What the plan includes; the dashboard gates features from this, the API enforces it. */
    entitlements: Entitlements;
  };
  subscription: {
    id: string;
    status: string;
    billingCycle: "MONTHLY" | "YEARLY";
    cancelAtPeriodEnd: boolean;
    cancelAt: string | null;
    trialEndsAt: string | null;
    graceEndsAt: string | null;
    /** True when a subscription exists at the provider to change or cancel. */
    isProviderBacked: boolean;
  } | null;
  /**
   * What the base plan costs and when it renews. For annual customers this is
   * the prepaid year and is shown apart from monthly usage; for monthly
   * customers it coincides with the usage period.
   */
  base: {
    cycle: "MONTHLY" | "YEARLY";
    priceCents: number;
    /** Base price expressed per month; what the spend cap is measured against. */
    monthlyEquivalentCents: number;
    periodStart: string | null;
    periodEnd: string | null;
  };
  access: Access;
  /** A downgrade scheduled for the end of the paid period, if any. */
  pendingChange: { planId: string; planName: string; billingCycle: "MONTHLY" | "YEARLY"; effectiveAt: string } | null;
  /** Present while the account is on a local (no card) trial. */
  trial: {
    planName: string;
    startsAt: string | null;
    endsAt: string;
    daysRemaining: number;
    /** What the account drops to when the trial ends. */
    fallbackPlanName: string;
  } | null;
  /** Spending protection as the customer sees it. applies=false on free and trial. */
  spendCap: {
    applies: boolean;
    capCents: number | null;
    minCents: number | null;
    maxCents: number | null;
    defaultCents: number | null;
    isDefault: boolean;
    pendingCents: number | null;
    monthlyBaseCents: number;
  };
  /** Site allowance versus what the account has; inactive sites keep history but do not ingest. */
  sites: {
    limit: number;
    active: number;
    inactive: { id: string; domain: string; reason: string | null }[];
  };
  period: {
    start: string | null;
    end: string | null;
    /** Percent of the period elapsed, 0..100. */
    elapsedPercent: number;
  };
  usage: UsageComputation & {
    /**
     * What this usage period's invoice will carry: base plus overage for a
     * monthly customer, overage only for an annual one (the base was prepaid).
     */
    periodChargesCents: number;
    /** Straight-line estimate of period-end events. */
    projectedEvents: number;
    /** Estimated period-end charges in cents, capped by the spend cap. */
    projectedBillCents: number;
    lastComputedAt: string | null;
  };
};

export { monthlyEquivalentBase };

/**
 * Everything the billing page shows about usage, from the ledger only. The
 * front end does no arithmetic of its own.
 */
export const getUsageSummary = async (
  { prisma }: Pick<AppContext, "prisma">,
  userId: string,
  now: Date = new Date(),
): Promise<UsageSummary> => {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: { in: [...LIVE_STATUSES] } },
    orderBy: { createdAt: "desc" },
    include: {
      plan: true,
      billingPeriodUsages: { where: { status: "OPEN" }, orderBy: { periodStart: "desc" }, take: 1 },
    },
  });

  const freePlan = await prisma.plan.findFirstOrThrow({ where: { isFree: true } });
  const plan = sub?.plan ?? freePlan;
  const period = sub?.billingPeriodUsages[0] ?? null;

  const websites = await prisma.website.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, domain: true, isActive: true, restrictionReason: true },
  });
  const entitlements = parseEntitlements(plan.entitlements);
  const siteLimit = entitlements.sites;

  const isLocalTrial = sub?.status === "TRIALING" && !sub.providerSubscriptionId && sub.trialEndsAt;
  const trial = isLocalTrial
    ? {
        planName: plan.name,
        startsAt: sub!.trialStartsAt?.toISOString() ?? null,
        endsAt: sub!.trialEndsAt!.toISOString(),
        daysRemaining: Math.max(0, Math.ceil((sub!.trialEndsAt!.getTime() - now.getTime()) / 86_400_000)),
        fallbackPlanName: freePlan.name,
      }
    : null;

  const cycle = sub?.billingCycle ?? "MONTHLY";
  // Spend cap and "current bill" are measured per usage period in monthly
  // terms, so monthly and annual customers get the same protection. A trial
  // runs on a paid plan's allowance but bills nothing, so its base is zero.
  const basePriceCents = sub && !isLocalTrial ? monthlyEquivalentBase(plan, cycle) : 0;

  const includedEvents = period ? Number(period.includedEvents) : plan.eventLimit;
  const cap = sub
    ? resolveSpendCap(plan, sub)
    : resolveSpendCap(plan, { billingCycle: "MONTHLY", providerSubscriptionId: null, spendCapCents: null, pendingSpendCapCents: null });
  const spendCapCents = cap.applies ? cap.capCents : null;
  // Overage is billable only when a provider subscription can be charged, the
  // same rule as restriction.service and usageWithCap. A trial or the free
  // plan runs on a plan that carries an overage price but has no card, so it
  // is a hard limit: reporting it as pay-as-you-go told trialists they would
  // be billed beyond the allowance when tracking in fact pauses.
  const overagePricePer1k = cap.applies ? plan.overagePricePer1k : null;

  const usage = computeUsage({
    totalEvents: period ? Number(period.totalEvents) : 0,
    includedEvents,
    overagePricePer1k,
    basePriceCents,
    spendCapCents,
  });
  // Annual customers prepaid the base; this period's invoice is overage only.
  const periodChargesCents = cycle === "YEARLY" ? usage.overageCents : usage.currentBillCents;

  const start = sub?.currentPeriodStart ?? null;
  const end = sub?.currentPeriodEnd ?? null;
  const elapsedPercent =
    start && end && end > start
      ? Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100))
      : 0;

  const projectedEvents = start && end ? projectPeriodTotal(usage.totalEvents, start, end, now) : usage.totalEvents;
  const projected = computeUsage({
    totalEvents: projectedEvents,
    includedEvents,
    overagePricePer1k,
    basePriceCents,
    spendCapCents,
  });
  const projectedTotal =
    projected.spendCapCents === null
      ? projected.currentBillCents
      : Math.min(projected.currentBillCents, projected.spendCapCents);
  const projectedBillCents = cycle === "YEARLY" ? Math.max(0, projectedTotal - basePriceCents) : projectedTotal;

  const pendingPlan = sub?.pendingPlanId ? await prisma.plan.findUnique({ where: { id: sub.pendingPlanId }, select: { name: true } }) : null;
  const pendingChange =
    sub?.pendingPlanId && sub.pendingChangeAt && pendingPlan
      ? { planId: sub.pendingPlanId, planName: pendingPlan.name, billingCycle: sub.pendingBillingCycle ?? sub.billingCycle, effectiveAt: sub.pendingChangeAt.toISOString() }
      : null;

  return {
    pendingChange,
    plan: {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      isFree: plan.isFree,
      overagePricePer1k: plan.overagePricePer1k,
      entitlements,
    },
    subscription: sub
      ? {
          id: sub.id,
          status: sub.status,
          billingCycle: sub.billingCycle,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          cancelAt: sub.cancelAt?.toISOString() ?? null,
          trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
          graceEndsAt: sub.graceEndsAt?.toISOString() ?? null,
          // Whether there is a subscription at the provider to modify. A plan
          // change, a cancellation and the invoice list all need one; a free
          // row and a local trial have none, so those accounts start a plan
          // through checkout instead. The id itself is never sent.
          isProviderBacked: sub.providerSubscriptionId !== null,
        }
      : null,
    trial,
    spendCap: cap,
    sites: {
      limit: siteLimit,
      active: websites.filter((w) => w.isActive).length,
      inactive: websites.filter((w) => !w.isActive).map((w) => ({ id: w.id, domain: w.domain, reason: w.restrictionReason })),
    },
    base: {
      cycle,
      priceCents: sub ? (cycle === "YEARLY" ? plan.yearlyPrice : plan.monthlyPrice) : 0,
      monthlyEquivalentCents: basePriceCents,
      periodStart: (sub?.basePeriodStart ?? start)?.toISOString() ?? null,
      periodEnd: (sub?.basePeriodEnd ?? end)?.toISOString() ?? null,
    },
    access: deriveAccess(
      sub
        ? {
            status: sub.status,
            restriction: sub.restriction,
            trialEndsAt: sub.trialEndsAt,
            graceEndsAt: sub.graceEndsAt,
            providerSubscriptionId: sub.providerSubscriptionId,
            plan: { isFree: plan.isFree },
          }
        : null,
      now,
    ),
    period: {
      start: start?.toISOString() ?? null,
      end: end?.toISOString() ?? null,
      elapsedPercent: Math.round(elapsedPercent * 10) / 10,
    },
    usage: {
      ...usage,
      // Infinity is not JSON; the UI treats null as "no allowance".
      usageRatio: Number.isFinite(usage.usageRatio) ? usage.usageRatio : (null as unknown as number),
      periodChargesCents,
      projectedEvents,
      projectedBillCents,
      lastComputedAt: period?.updatedAt.toISOString() ?? null,
    },
  };
};
