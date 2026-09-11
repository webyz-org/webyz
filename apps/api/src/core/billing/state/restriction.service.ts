import type { AppContext } from "../../../lib/context.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { LIVE_STATUSES, invalidateEntitlements } from "../entitlements/entitlement.service.js";
import { resolveSpendCap, usageWithCap } from "../spend-cap/spend-cap.service.js";
import { decideRestriction, isQuotaReached, type RestrictionDecision, type RestrictionKind } from "./restriction.js";

type Deps = Pick<AppContext, "prisma" | "redis">;

export type ReconcileResult = {
  userId: string;
  subscriptionId: string | null;
  /** The row's restriction before this reconcile. TRIAL_ENDED is a legacy value never written today. */
  previous: RestrictionKind | "TRIAL_ENDED" | null;
  decision: RestrictionDecision;
  /** Whether the account's sites were blocked before this reconcile. */
  wasBlocked: boolean;
  /** The subscription's restriction or any site's blocked flag changed. */
  changed: boolean;
  websitesBlocked: number;
  websitesUnblocked: number;
};

/**
 * The single writer of `subscriptions.restriction` and `websites.isBlocked`.
 *
 * Loads the account's live subscription, its plan, its current usage period
 * and its sites; evaluates `decideRestriction` over them; writes the result
 * to the subscription row and to every site, all inside one transaction that
 * holds a row lock on the user. Two flows reconciling the same account at
 * once therefore serialise, and the second one sees the first one's facts.
 *
 * Callers change a fact first (status, graceEndsAt, spendCapCents, a new
 * period, a new subscription row) and then call this. They never set
 * `restriction` or `isBlocked` themselves.
 *
 * With no live subscription the account is treated as free with nothing
 * blocked, matching `deriveAccess(null)`; the hourly backfill creates the row.
 */
export const reconcileRestriction = async (ctx: Deps, userId: string, now: Date = new Date()): Promise<ReconcileResult> => {
  const { prisma } = ctx;

  const result = await prisma.$transaction(async (tx) => {
    // Serialise every restriction decision for this account.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;

    const sub = await tx.subscription.findFirst({
      where: { userId, status: { in: [...LIVE_STATUSES] } },
      orderBy: { createdAt: "desc" },
      include: {
        plan: true,
        billingPeriodUsages: { where: { status: "OPEN" }, orderBy: { periodStart: "desc" }, take: 1 },
      },
    });
    const websites = await tx.website.findMany({ where: { userId }, select: { id: true, isBlocked: true } });
    const wasBlocked = websites.some((w) => w.isBlocked);

    const period = sub?.billingPeriodUsages[0] ?? null;
    const facts = sub
      ? (() => {
          const isPayg = resolveSpendCap(sub.plan, sub).applies;
          const included = period ? Number(period.includedEvents) || sub.plan.eventLimit : sub.plan.eventLimit;
          const total = period ? Number(period.totalEvents) : 0;
          return {
            status: sub.status,
            graceEndsAt: sub.graceEndsAt,
            isPayg,
            capReached: isPayg && period !== null && usageWithCap(sub.plan, sub, { totalEvents: total, includedEvents: included }).capReached,
            quotaReached: !isPayg && period !== null && isQuotaReached(total, included),
          };
        })()
      : null;

    const decision = facts
      ? decideRestriction(facts, now)
      : { restriction: "NONE" as const, blocked: false, reasons: { paymentFailed: false, capReached: false, quotaReached: false } };

    let changed = false;
    if (sub && sub.restriction !== decision.restriction) {
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          restriction: decision.restriction,
          restrictedAt: decision.restriction === "NONE" ? null : now,
        },
      });
      changed = true;
    }

    // The period remembers when spending protection fired, for the bill view.
    if (sub && period) {
      const stamp: Prisma.BillingPeriodUsageUpdateInput = {};
      if (decision.reasons.capReached && !period.spendCapTriggeredAt) stamp.spendCapTriggeredAt = now;
      if (!decision.reasons.capReached && period.spendCapTriggeredAt) stamp.spendCapTriggeredAt = null;
      if (Object.keys(stamp).length) await tx.billingPeriodUsage.update({ where: { id: period.id }, data: stamp });
    }

    const toBlock = websites.filter((w) => !w.isBlocked && decision.blocked).map((w) => w.id);
    const toUnblock = websites.filter((w) => w.isBlocked && !decision.blocked).map((w) => w.id);
    if (toBlock.length) {
      await tx.website.updateMany({ where: { id: { in: toBlock } }, data: { isBlocked: true, blockedAt: now } });
      changed = true;
    }
    if (toUnblock.length) {
      await tx.website.updateMany({ where: { id: { in: toUnblock } }, data: { isBlocked: false, blockedAt: null } });
      changed = true;
    }

    return {
      userId,
      subscriptionId: sub?.id ?? null,
      previous: sub?.restriction ?? null,
      decision,
      wasBlocked,
      changed,
      websitesBlocked: toBlock.length,
      websitesUnblocked: toUnblock.length,
    } satisfies ReconcileResult;
  });

  if (result.changed) {
    await invalidateEntitlements(ctx, userId);
    console.log(
      `[restriction] user ${userId}: ${result.previous ?? "none"} -> ${result.decision.restriction}` +
        ` (${result.websitesBlocked} site(s) blocked, ${result.websitesUnblocked} unblocked)`,
    );
  }
  return result;
};

/** Same, addressed by subscription id. */
export const reconcileRestrictionForSubscription = async (ctx: Deps, subscriptionId: string, now: Date = new Date()) => {
  const sub = await ctx.prisma.subscription.findUnique({ where: { id: subscriptionId }, select: { userId: true } });
  if (!sub) return null;
  return reconcileRestriction(ctx, sub.userId, now);
};
