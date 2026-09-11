import type { AppContext } from "../../../lib/context.js";
import { badRequest, notFound } from "../../../errors/http-errors.js";
import { parseEntitlements, type Entitlements, type FeatureKey, type LimitKey } from "../catalog/entitlements.schema.js";
import { LIVE_STATUSES } from "../entitlements/entitlement.service.js";
import { FEATURE_LABELS, LIMIT_LABELS } from "../entitlements/entitlement.guard.js";
import type { BillingProvider } from "../provider/billing-provider.js";
import { resolvePrices } from "../billing.service.js";
import { syncSubscription } from "./lifecycle.service.js";
import { pickActiveSites } from "./site-limit.service.js";
import { notifyOnce } from "../notifications/notification.service.js";
import { planChangeScheduledEmail } from "../../email/templates/index.js";

type Cycle = "MONTHLY" | "YEARLY";

/**
 * Plan changes.
 *
 *  - Upgrade (higher plan, or the same plan from monthly to annual): now, with
 *    the provider prorating the base. Entitlements refresh immediately.
 *  - Downgrade (lower plan, or annual to monthly): the provider is told to
 *    bill the new price from the next renewal and to charge nothing now, while
 *    entitlements stay on the paid-for plan until the base period ends.
 *    That boundary is a local pending change the customer can undo, because
 *    Paddle has no provider-side schedule for an item change.
 *
 * Both are previewed first: what changes, what is lost, which sites would go
 * inactive, and when. Nothing is deleted by a change.
 */

export type ChangeKind = "upgrade" | "downgrade" | "same";

export const classifyChange = (
  from: { sortOrder: number; cycle: Cycle },
  to: { sortOrder: number; cycle: Cycle },
): ChangeKind => {
  if (to.sortOrder > from.sortOrder) return "upgrade";
  if (to.sortOrder < from.sortOrder) return "downgrade";
  if (from.cycle === to.cycle) return "same";
  return to.cycle === "YEARLY" ? "upgrade" : "downgrade";
};


export type EntitlementDiff = {
  limits: { key: LimitKey; label: string; from: number; to: number }[];
  featuresGained: { key: FeatureKey; label: string }[];
  featuresLost: { key: FeatureKey; label: string }[];
};

export const diffEntitlements = (from: Entitlements, to: Entitlements): EntitlementDiff => {
  const limits = (Object.keys(LIMIT_LABELS) as LimitKey[])
    .filter((k) => from[k] !== to[k])
    .map((k) => ({ key: k, label: LIMIT_LABELS[k], from: from[k], to: to[k] }));
  const features = Object.keys(FEATURE_LABELS) as FeatureKey[];
  return {
    limits,
    featuresGained: features.filter((k) => !from[k] && to[k]).map((k) => ({ key: k, label: FEATURE_LABELS[k] })),
    featuresLost: features.filter((k) => from[k] && !to[k]).map((k) => ({ key: k, label: FEATURE_LABELS[k] })),
  };
};

export type ChangePreview = {
  kind: ChangeKind;
  effective: "now" | "base_period_end";
  effectiveAt: string | null;
  from: { planId: string; code: string; name: string; cycle: Cycle; priceCents: number };
  to: { planId: string; code: string; name: string; cycle: Cycle; priceCents: number };
  diff: EntitlementDiff;
  sites: { total: number; limitAfter: number; wouldGoInactive: { id: string; domain: string }[]; wouldReactivate: { id: string; domain: string }[] };
  /** Retention shrinking means older data stops being shown, never deleted by the change itself. */
  notes: string[];
};

const loadCurrent = async ({ prisma }: Pick<AppContext, "prisma">, userId: string) => {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: { in: [...LIVE_STATUSES] } },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });
  if (!sub) throw notFound("No active subscription found");
  return sub;
};

export const previewPlanChange = async (
  ctx: Pick<AppContext, "prisma">,
  userId: string,
  target: { planId: string; billingCycle: Cycle },
): Promise<ChangePreview> => {
  const { prisma } = ctx;
  const sub = await loadCurrent(ctx, userId);
  const to = await prisma.plan.findUnique({ where: { id: target.planId } });
  if (!to || !to.isActive) throw notFound("Plan not found");

  const kind = classifyChange({ sortOrder: sub.plan.sortOrder, cycle: sub.billingCycle }, { sortOrder: to.sortOrder, cycle: target.billingCycle });
  const fromE = parseEntitlements(sub.plan.entitlements);
  const toE = parseEntitlements(to.entitlements);
  const diff = diffEntitlements(fromE, toE);

  const sites = await prisma.website.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true, domain: true, isActive: true, createdAt: true } });
  const pick = pickActiveSites(sites, toE.sites);

  const effective = kind === "downgrade" && sub.providerSubscriptionId ? "base_period_end" : "now";
  const effectiveAt = effective === "now" ? null : (sub.basePeriodEnd ?? sub.currentPeriodEnd)?.toISOString() ?? null;

  const notes: string[] = [];
  if (kind === "upgrade" && sub.providerSubscriptionId) notes.push("You are charged the prorated difference for the rest of this period.");
  if (kind === "downgrade" && sub.providerSubscriptionId) notes.push("The change applies when your current period ends. Until then you keep everything you have paid for.");
  if (toE.retention_days < fromE.retention_days) notes.push(`Reports will show the last ${toE.retention_days} days instead of ${fromE.retention_days}. Nothing is deleted by this change.`);
  if (pick.toRestrict.length) notes.push(`${pick.toRestrict.length} site${pick.toRestrict.length === 1 ? "" : "s"} would stop collecting new data. History is kept; you can choose which sites stay active.`);
  if (!sub.providerSubscriptionId && !to.isFree) notes.push("Checkout is required to start a paid plan.");

  return {
    kind,
    effective,
    effectiveAt,
    from: { planId: sub.plan.id, code: sub.plan.code, name: sub.plan.name, cycle: sub.billingCycle, priceCents: sub.billingCycle === "YEARLY" ? sub.plan.yearlyPrice : sub.plan.monthlyPrice },
    to: { planId: to.id, code: to.code, name: to.name, cycle: target.billingCycle, priceCents: target.billingCycle === "YEARLY" ? to.yearlyPrice : to.monthlyPrice },
    diff,
    sites: {
      total: sites.length,
      limitAfter: toE.sites,
      wouldGoInactive: pick.toRestrict.map((s) => ({ id: s.id, domain: s.domain })),
      wouldReactivate: pick.toActivate.map((s) => ({ id: s.id, domain: s.domain })),
    },
    notes,
  };
};

export type ChangeResult =
  | { applied: "now"; planId: string; billingCycle: Cycle }
  | { applied: "scheduled"; planId: string; billingCycle: Cycle; effectiveAt: Date };

/** Apply or schedule a plan change for a paid subscription. */
export const requestPlanChange = async (
  ctx: AppContext,
  provider: BillingProvider,
  userId: string,
  target: { planId: string; billingCycle: Cycle },
): Promise<ChangeResult> => {
  const { prisma } = ctx;
  const sub = await loadCurrent(ctx, userId);
  if (!sub.providerSubscriptionId) throw badRequest("The free plan has no paid subscription to change. Choose a plan to start checkout.");
  const to = await prisma.plan.findUnique({ where: { id: target.planId } });
  if (!to) throw notFound("Plan not found");
  const { basePriceId } = resolvePrices(to, target.billingCycle);

  if (sub.planId === to.id && sub.billingCycle === target.billingCycle) {
    throw badRequest("You are already on that plan and billing cycle.");
  }

  const kind = classifyChange({ sortOrder: sub.plan.sortOrder, cycle: sub.billingCycle }, { sortOrder: to.sortOrder, cycle: target.billingCycle });

  if (kind === "downgrade") {
    const effectiveAt = sub.basePeriodEnd ?? sub.currentPeriodEnd;
    if (!effectiveAt) throw badRequest("This subscription has no period end yet; try again once it has renewed.");

    // The provider swaps the price and bills nothing: the next renewal is at
    // the new, lower amount. Entitlements are pinned to the current plan by
    // the pending record below, so the customer keeps what they paid for.
    const updated = await provider.changePlan({
      providerSubscriptionId: sub.providerSubscriptionId,
      basePriceId,
      billing: "defer",
    });

    try {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { pendingPlanId: to.id, pendingBillingCycle: target.billingCycle, pendingChangeAt: effectiveAt },
      });
    } catch (err) {
      // The provider is on the new price with no local record of why. Put it
      // back rather than leave a downgrade nobody can see or undo.
      await provider
        .changePlan({
          providerSubscriptionId: sub.providerSubscriptionId,
          basePriceId: sub.billingCycle === "YEARLY" ? sub.plan.providerPriceYearlyId! : sub.plan.providerPriceMonthlyId!,
          billing: "defer",
        })
        .catch((e) => console.error(`[plan-change] could not undo the provider price for subscription ${sub.id}:`, e));
      throw err;
    }

    // Record everything else the provider now reports (a changed period, a
    // status), without letting it move the plan: the pending row pins it.
    await syncSubscription(ctx, provider, updated, { userId });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true } });
    await notifyOnce(ctx, {
      subscriptionId: sub.id,
      kind: "subscription_changed",
      scopeKey: `scheduled:${to.id}:${target.billingCycle}:${effectiveAt.toISOString()}`,
      message: planChangeScheduledEmail(user.email, { name: user.name, fromPlan: sub.plan.name, toPlan: to.name, toCycle: target.billingCycle, effectiveAt }),
    });
    return { applied: "scheduled", planId: to.id, billingCycle: target.billingCycle, effectiveAt };
  }

  // Upgrade: any pending downgrade is superseded and the change is immediate,
  // with the provider prorating the difference.
  if (sub.pendingPlanId) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { pendingPlanId: null, pendingBillingCycle: null, pendingChangeAt: null },
    });
  }
  const updated = await provider.changePlan({
    providerSubscriptionId: sub.providerSubscriptionId,
    basePriceId,
    billing: "prorate_now",
  });
  await syncSubscription(ctx, provider, updated, { userId, planId: to.id, billingCycle: target.billingCycle });
  return { applied: "now", planId: to.id, billingCycle: target.billingCycle };
};

/** Undo a scheduled downgrade: back to the plan the customer is on today. */
export const cancelPendingChange = async (ctx: AppContext, provider: BillingProvider, userId: string) => {
  const sub = await loadCurrent(ctx, userId);
  if (!sub.pendingPlanId || !sub.providerSubscriptionId) {
    throw badRequest("There is no scheduled plan change to cancel.");
  }
  const { basePriceId } = resolvePrices(sub.plan, sub.billingCycle);
  const updated = await provider.changePlan({
    providerSubscriptionId: sub.providerSubscriptionId,
    basePriceId,
    billing: "defer",
  });
  await ctx.prisma.subscription.update({
    where: { id: sub.id },
    data: { pendingPlanId: null, pendingBillingCycle: null, pendingChangeAt: null },
  });
  await syncSubscription(ctx, provider, updated, { userId, planId: sub.planId, billingCycle: sub.billingCycle });
  return { canceled: true };
};

/**
 * Apply plan changes that have come due.
 *
 * The provider has been billing the new price since the boundary, so this only
 * moves the local plan across: re-reading the subscription and syncing does
 * it, because `syncSubscription` stops pinning the old plan once
 * `pendingChangeAt` has passed. Idempotent, and safe to run late.
 */
export const applyDuePlanChanges = async (
  ctx: AppContext,
  provider: BillingProvider,
  now: Date = new Date(),
  scope?: { subscriptionIds?: string[] },
): Promise<{ applied: number; failed: number }> => {
  const due = await ctx.prisma.subscription.findMany({
    where: {
      ...(scope?.subscriptionIds ? { id: { in: scope.subscriptionIds } } : {}),
      pendingPlanId: { not: null },
      pendingChangeAt: { lte: now },
      providerSubscriptionId: { not: null },
      status: { in: [...LIVE_STATUSES] },
    },
    select: { id: true, providerSubscriptionId: true },
  });

  let applied = 0;
  let failed = 0;
  for (const sub of due) {
    try {
      const current = await provider.getSubscription(sub.providerSubscriptionId as string);
      await syncSubscription(ctx, provider, current, undefined, { now });
      applied += 1;
    } catch (err) {
      failed += 1;
      console.error(`[plan-change] could not apply the due change on ${sub.id}:`, err);
    }
  }
  if (due.length) console.log(`[plan-change] ${applied} due change(s) applied, ${failed} failed`);
  return { applied, failed };
};

export type CancelPreview = {
  accessUntil: string | null;
  cycle: Cycle;
  planName: string;
  fallbackPlanName: string;
  fallback: { sites: number; eventsPerPeriod: number; retentionDays: number };
  sitesThatWouldGoInactive: { id: string; domain: string }[];
  featuresLost: { key: FeatureKey; label: string }[];
  notes: string[];
};

export const previewCancellation = async (ctx: Pick<AppContext, "prisma">, userId: string): Promise<CancelPreview> => {
  const { prisma } = ctx;
  const sub = await loadCurrent(ctx, userId);
  const free = await prisma.plan.findFirstOrThrow({ where: { isFree: true } });
  const fromE = parseEntitlements(sub.plan.entitlements);
  const freeE = parseEntitlements(free.entitlements);
  const sites = await prisma.website.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true, domain: true, isActive: true, createdAt: true } });
  const pick = pickActiveSites(sites, freeE.sites);
  const accessUntil = sub.providerSubscriptionId ? (sub.basePeriodEnd ?? sub.currentPeriodEnd) : null;
  const notes = [
    accessUntil
      ? `You keep the ${sub.plan.name} plan until ${accessUntil.toISOString().slice(0, 10)}, then move to the ${free.name} plan. No refund is issued for the remaining time; you can resume before then.`
      : `You are on the ${free.name} plan; there is no paid subscription to cancel.`,
    "All of your analytics data is kept.",
  ];
  return {
    accessUntil: accessUntil?.toISOString() ?? null,
    cycle: sub.billingCycle,
    planName: sub.plan.name,
    fallbackPlanName: free.name,
    fallback: { sites: freeE.sites, eventsPerPeriod: freeE.events_per_period, retentionDays: freeE.retention_days },
    sitesThatWouldGoInactive: pick.toRestrict.map((s) => ({ id: s.id, domain: s.domain })),
    featuresLost: diffEntitlements(fromE, freeE).featuresLost,
    notes,
  };
};
