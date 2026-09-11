import { AppContext } from "../../lib/context.js";
import { reconcileRestrictionForSubscription } from "./state/restriction.service.js";
import { addMonths, deriveUsagePeriod } from "./subscription/periods.js";

type Deps = Pick<AppContext, "prisma">;
/** Rollover also reconciles restrictions, which needs the Redis cache to invalidate. */
type RolloverDeps = Pick<AppContext, "prisma" | "redis">;

/**
 * Put a user on the free plan.
 *
 * Every user needs a Subscription row, not just paying ones: the usage sync and
 * quota enforcement jobs both iterate subscriptions, so a user without one was
 * never metered and the free event limit was never actually enforced. The
 * cancellation path already assumed a free subscription exists, so this
 * makes the whole billing model consistent.
 *
 * Safe to call repeatedly: it does nothing if the user already has one.
 */
export const assignFreePlan = async ({ prisma }: Deps, userId: string) => {
  const existing = await prisma.subscription.findFirst({
    where: { userId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"] } },
  });
  if (existing) return existing;

  const freePlan = await prisma.plan.findFirst({ where: { isFree: true } });
  if (!freePlan) {
    // Not fatal: signup should still succeed on a database without seeds.
    console.error("[free-plan] no free plan configured, skipping assignment");
    return null;
  }

  const periodStart = new Date();

  return prisma.subscription.create({
    data: {
      userId,
      planId: freePlan.id,
      status: "ACTIVE",
      billingCycle: "MONTHLY",
      currentPeriodStart: periodStart,
      currentPeriodEnd: addMonths(periodStart),
    },
  });
};

/**
 * Give every user without a live subscription a free one.
 *
 * Accounts created before free-plan assignment existed at signup have no
 * subscription row at all, so they were invisible to usage sync and quota
 * enforcement and could track unlimited events for free. Runs at the start of
 * every usage sync; it is a no-op once everyone has a row.
 */
export const backfillFreePlans = async ({ prisma }: Deps) => {
  const missing = await prisma.user.findMany({
    where: {
      subscriptions: {
        none: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"] } },
      },
    },
    select: { id: true },
  });

  for (const user of missing) {
    await assignFreePlan({ prisma }, user.id);
  }

  if (missing.length) {
    console.log(`[free-plan] backfilled ${missing.length} user(s) onto the free plan`);
  }

  return missing.length;
};

/**
 * Advance usage periods that only exist locally.
 *
 * Two kinds have no provider event to move them:
 *
 *  - free and trial subscriptions, which have no provider object at all;
 *  - annual paid subscriptions, whose provider period is the prepaid year
 *    while the quota is monthly, so the monthly window is ours to roll.
 *
 * Without this their window would stay in the past and the allowance would
 * never reset. `ensureOpenPeriod` closes the old period on the next usage sync,
 * which is why this runs first.
 */
export const rollLocalUsagePeriods = async ({ prisma, redis }: RolloverDeps) => {
  const now = new Date();
  let rolled = 0;

  const local = await prisma.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "TRIALING"] },
      currentPeriodEnd: { lt: now },
      OR: [{ providerSubscriptionId: null }, { billingCycle: "YEARLY" }],
    },
    select: {
      id: true,
      providerSubscriptionId: true,
      billingCycle: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      basePeriodStart: true,
      basePeriodEnd: true,
    },
  });

  for (const sub of local) {
    let start: Date;
    let end: Date;

    if (sub.providerSubscriptionId && sub.billingCycle === "YEARLY" && sub.basePeriodStart && sub.basePeriodEnd) {
      // Anchored to the year the customer paid for, so windows never drift.
      const window = deriveUsagePeriod({ start: sub.basePeriodStart, end: sub.basePeriodEnd }, "YEARLY", now);
      // Past the end of the prepaid year there is nothing to roll: the
      // provider's renewal moves the base period, and this then follows.
      if (!window || window.end <= (sub.currentPeriodEnd ?? now)) continue;
      ({ start, end } = window);
    } else {
      // Walk forward from the old end so periods stay aligned to the signup day.
      start = sub.currentPeriodEnd ?? now;
      end = addMonths(start);
      while (end < now) {
        start = end;
        end = addMonths(start);
      }
    }

    await prisma.subscription.update({
      where: { id: sub.id },
      data: { currentPeriodStart: start, currentPeriodEnd: end },
    });
    rolled += 1;

    // A fresh period means a fresh allowance: lift a FREE_QUOTA or SPEND_CAP
    // restriction now rather than leaving the site paused until the next
    // enforcement run.
    await reconcileRestrictionForSubscription({ prisma, redis }, sub.id, now);
  }

  if (rolled) {
    console.log(`[usage-period] rolled ${rolled} local period(s)`);
  }

  return rolled;
};
