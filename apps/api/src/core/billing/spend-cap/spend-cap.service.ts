import type { AppContext } from "../../../lib/context.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { badRequest, notFound } from "../../../errors/http-errors.js";
import { invalidateEntitlements, LIVE_STATUSES } from "../entitlements/entitlement.service.js";
import { reconcileRestriction } from "../state/restriction.service.js";
import { computeUsage, monthlyEquivalentBase, type UsageComputation } from "../usage/usage-math.js";

type Deps = Pick<AppContext, "prisma" | "redis">;

/**
 * Spending protection.
 *
 * The cap is a monthly figure, base included, so monthly and annual customers
 * get the same protection: for annual plans the base is the yearly price / 12.
 * Free and trial subscriptions have no cap because they have no overage.
 *
 * Rules agreed (decisions 8 and 9):
 *  - default = plan default (2x monthly base), minimum = plan minimum
 *    (1x monthly base), no maximum unless the plan sets one;
 *  - raising the cap applies now and lifts an active SPEND_CAP restriction,
 *    unless the account is restricted for non-payment (state/restriction.ts);
 *  - lowering the cap to at or below what this period already costs never
 *    invalidates incurred usage: it becomes the cap from the next period.
 */

export type PlanCapFields = {
  monthlyPrice: number;
  yearlyPrice: number;
  overagePricePer1k: number | null;
  spendCapDefaultCents: number | null;
  spendCapMinCents: number | null;
  spendCapMaxCents: number | null;
};

export type SubCapFields = {
  billingCycle: "MONTHLY" | "YEARLY";
  providerSubscriptionId: string | null;
  spendCapCents: number | null;
  pendingSpendCapCents: number | null;
};

export type ResolvedCap = {
  /** Whether a cap applies at all (paid, pay-as-you-go, provider-backed). */
  applies: boolean;
  capCents: number | null;
  minCents: number | null;
  maxCents: number | null;
  defaultCents: number | null;
  isDefault: boolean;
  pendingCents: number | null;
  /** Base per month the cap is measured against. */
  monthlyBaseCents: number;
};

export const resolveSpendCap = (plan: PlanCapFields, sub: SubCapFields): ResolvedCap => {
  const applies = plan.overagePricePer1k !== null && sub.providerSubscriptionId !== null;
  const monthlyBaseCents = monthlyEquivalentBase(plan, sub.billingCycle);
  if (!applies) {
    return { applies, capCents: null, minCents: null, maxCents: null, defaultCents: null, isDefault: true, pendingCents: null, monthlyBaseCents };
  }
  const capCents = sub.spendCapCents ?? plan.spendCapDefaultCents;
  return {
    applies,
    capCents,
    minCents: plan.spendCapMinCents,
    maxCents: plan.spendCapMaxCents,
    defaultCents: plan.spendCapDefaultCents,
    isDefault: sub.spendCapCents === null,
    pendingCents: sub.pendingSpendCapCents,
    monthlyBaseCents,
  };
};

/** Usage maths for a period with the cap resolved. */
export const usageWithCap = (
  plan: PlanCapFields,
  sub: SubCapFields,
  period: { totalEvents: bigint | number; includedEvents: bigint | number },
): UsageComputation => {
  const cap = resolveSpendCap(plan, sub);
  return computeUsage({
    totalEvents: Number(period.totalEvents),
    includedEvents: Number(period.includedEvents),
    overagePricePer1k: cap.applies ? plan.overagePricePer1k : null,
    basePriceCents: cap.monthlyBaseCents,
    spendCapCents: cap.capCents,
  });
};

export type SetCapResult = {
  capCents: number;
  effective: "now" | "next_period";
  pendingCents: number | null;
  /** True when the period's cost already meets or exceeds the requested cap. */
  alreadyExceeded: boolean;
  currentBillCents: number;
  restrictionLifted: boolean;
  message: string;
};

export const setSpendCap = async (ctx: Deps, userId: string, capCents: number): Promise<SetCapResult> => {
  const { prisma } = ctx;
  if (!Number.isInteger(capCents) || capCents < 0) throw badRequest("The spending cap must be a whole number of cents.");

  const sub = await prisma.subscription.findFirst({
    where: { userId, status: { in: [...LIVE_STATUSES] } },
    orderBy: { createdAt: "desc" },
    include: { plan: true, billingPeriodUsages: { where: { status: "OPEN" }, orderBy: { periodStart: "desc" }, take: 1 } },
  });
  if (!sub) throw notFound("No active subscription found");

  const cap = resolveSpendCap(sub.plan, sub);
  if (!cap.applies) {
    throw badRequest("Spending caps apply to paid plans with usage billing. The free plan and trials never bill overage.");
  }
  if (cap.minCents !== null && capCents < cap.minCents) {
    throw badRequest(`The spending cap cannot be below your plan's base price (${formatCents(cap.minCents)} a month).`);
  }
  if (cap.maxCents !== null && capCents > cap.maxCents) {
    throw badRequest(`The spending cap cannot be above ${formatCents(cap.maxCents)} on this plan.`);
  }

  const period = sub.billingPeriodUsages[0];
  const usageNow = usageWithCap(sub.plan, sub, period ?? { totalEvents: 0, includedEvents: sub.plan.eventLimit });
  const currentBillCents = usageNow.currentBillCents;
  const currentCap = cap.capCents ?? 0;

  // Lowering to a figure this period has already reached: defer, explain.
  if (capCents < currentCap && currentBillCents >= capCents) {
    await prisma.subscription.update({ where: { id: sub.id }, data: { pendingSpendCapCents: capCents } });
    return {
      capCents: currentCap,
      effective: "next_period",
      pendingCents: capCents,
      alreadyExceeded: true,
      currentBillCents,
      restrictionLifted: false,
      message: `This period has already cost ${formatCents(currentBillCents)}, so the new cap of ${formatCents(capCents)} starts with your next usage period. Your current cap of ${formatCents(currentCap)} stays until then; nothing already used is affected.`,
    };
  }

  // Otherwise apply now. Whether that lifts a cap restriction is decided by
  // the single restriction writer, which also weighs payment state: a higher
  // cap never reopens ingest for an account restricted for non-payment.
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { spendCapCents: capCents, pendingSpendCapCents: null },
  });
  const result = await reconcileRestriction(ctx, userId);
  const lift = result.wasBlocked && !result.decision.blocked;
  const stillBlocked = result.decision.blocked;
  await invalidateEntitlements(ctx, userId);

  return {
    capCents,
    effective: "now",
    pendingCents: null,
    alreadyExceeded: false,
    currentBillCents,
    restrictionLifted: lift,
    message: lift
      ? `Spending cap set to ${formatCents(capCents)}. Tracking has resumed.`
      : stillBlocked && result.decision.restriction === "PAYMENT_FAILED"
        ? `Spending cap set to ${formatCents(capCents)} a month. Tracking stays paused until the outstanding invoice is paid.`
        : `Spending cap set to ${formatCents(capCents)} a month.`,
  };
};

/** At a period rollover, a deferred lower cap takes effect. */
export const applyPendingSpendCap = async (tx: Prisma.TransactionClient | Deps["prisma"], subscriptionId: string) => {
  const sub = await tx.subscription.findUnique({ where: { id: subscriptionId }, select: { pendingSpendCapCents: true } });
  if (!sub || sub.pendingSpendCapCents === null) return false;
  await tx.subscription.update({
    where: { id: subscriptionId },
    data: { spendCapCents: sub.pendingSpendCapCents, pendingSpendCapCents: null },
  });
  console.log(`[spend-cap] subscription ${subscriptionId}: pending cap ${sub.pendingSpendCapCents} now in force`);
  return true;
};

export const formatCents = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
