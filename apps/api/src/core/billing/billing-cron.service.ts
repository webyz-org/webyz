import { clickhouse } from "../../lib/clickhouse.js";
import prisma from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { aggregatePeriod, ensureOpenPeriod } from "./usage/aggregation.service.js";
import { nextThresholdCrossed } from "./usage/usage-math.js";
import { resolveSpendCap, usageWithCap } from "./spend-cap/spend-cap.service.js";
import { notifyOnce } from "./notifications/notification.service.js";
import { reconcileRestriction } from "./state/restriction.service.js";
import { BILLING_CONFIG } from "./catalog/billing.config.js";
import {
  limitWarningEmail,
  overQuotaEmail,
  spendCapApproachingEmail,
  spendCapReachedEmail,
} from "../email/templates/index.js";

/**
 * Hourly usage sync: for every live subscription, make sure the current usage
 * period exists (closing any it has rolled past), then recompute it from
 * ClickHouse into hourly buckets. See usage/aggregation.service.ts.
 */
export async function syncUsageFromClickhouse(): Promise<void> {
  console.log("[sync-usage] Starting");

  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
      currentPeriodStart: { not: null },
      currentPeriodEnd: { not: null },
    },
    select: {
      id: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      plan: { select: { entitlements: true } },
      user: { select: { websites: { select: { id: true } } } },
    },
  });

  console.log(`[sync-usage] Processing ${subscriptions.length} active subscriptions`);

  let synced = 0;
  let failed = 0;
  const now = new Date();

  for (const sub of subscriptions) {
    // Filtered above; narrowed here for the type system.
    if (!sub.currentPeriodStart || !sub.currentPeriodEnd) continue;
    const ledgerSub = {
      ...sub,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
    };

    try {
      const period = await ensureOpenPeriod({ prisma, clickhouse }, ledgerSub, now);
      const result = await aggregatePeriod({ prisma, clickhouse }, ledgerSub, period, now);
      synced++;
      console.log(
        `[sync-usage] sub ${sub.id}: ${result.totalEvents} billable events ` +
          `(${result.closedBuckets} closed hours + ${result.liveHourEvents} live), ` +
          `included ${result.includedEvents}, overage ${result.overageEvents}`,
      );
    } catch (err) {
      failed++;
      console.error(`[sync-usage] Failed for subscription ${sub.id}:`, err);
    }
  }

  console.log(`[sync-usage] Done — ${synced} synced, ${failed} failed`);
}

// Overage reporting moved to reporting/usage-reporting.service.ts (hourly deltas).

// Thresholds come from the catalog: free and paid can differ.

export async function enforceUsageLimits(scope?: { subscriptionIds?: string[] }): Promise<void> {
  console.log("[enforce-limits] Starting");

  const now = new Date();

  // Load all active billing periods with their subscription + plan + user websites
  const periods = await prisma.billingPeriodUsage.findMany({
    where: {
      ...(scope?.subscriptionIds ? { subscriptionId: { in: scope.subscriptionIds } } : {}),
      periodStart: { lte: now },
      periodEnd: { gte: now }, // only current (open) periods
      subscription: {
        status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
      },
    },
    include: {
      subscription: {
        include: {
          plan: true,
          user: {
            include: {
              websites: {
                select: { id: true, isBlocked: true },
              },
            },
          },
        },
      },
    },
  });

  console.log(
    `[enforce-limits] Checking ${periods.length} active billing periods`,
  );

  let blocked = 0;
  let unblocked = 0;
  let warned = 0;
  let failed = 0;

  for (const period of periods) {
    try {
      const result = await checkPeriod(period);
      if (result.blocked) blocked += result.blocked;
      if (result.unblocked) unblocked += result.unblocked;
      if (result.warned) warned++;
    } catch (err) {
      failed++;
      console.error(`[enforce-limits] Failed for period ${period.id}:`, err);
    }
  }

  console.log(
    `[enforce-limits] Done — ${blocked} websites blocked, ${unblocked} unblocked, ${warned} warnings sent, ${failed} failed`,
  );
}

/**
 * One open period: send the emails its usage calls for, then hand the
 * blocking decision to the single restriction writer (state/restriction.ts),
 * which weighs quota and cap together with payment state. Nothing here sets
 * `restriction` or `isBlocked` directly.
 */
async function checkPeriod(period: any): Promise<{
  blocked?: number;
  unblocked?: number;
  warned?: boolean;
}> {
  const { subscription, totalEvents } = period;
  const { plan, user } = subscription;
  const ctx = { prisma, redis };

  const included = Number(period.includedEvents) || plan.eventLimit;
  const usageRatio = included === 0 ? (Number(totalEvents) > 0 ? Infinity : 0) : Number(totalEvents) / included;

  // Overage can only be billed when there is a provider subscription to bill.
  // A trial runs on a paid plan's allowance with no card, so it is a hard
  // limit like Free; a spending cap bounds paying customers instead.
  const isPayg = plan.overagePricePer1k !== null && subscription.providerSubscriptionId !== null;

  let warned = false;
  if (isPayg) {
    warned = await sendWarningsIfNeeded(period, subscription, usageRatio);
    await sendSpendCapEmails(period, subscription);
  } else if (usageRatio >= 1.0) {
    // Sent once per period, on first crossing the allowance.
    const outcome = await notifyOnce(ctx, {
      subscriptionId: subscription.id,
      kind: "usage_100",
      scopeKey: period.id,
      message: overQuotaEmail(user.email, {
        name: user.name,
        planName: plan.name,
        totalEvents: Number(totalEvents),
        eventLimit: included,
      }),
    });
    warned = outcome === "sent";
  } else {
    warned = await sendWarningsIfNeeded(period, subscription, usageRatio);
  }

  const result = await reconcileRestriction(ctx, user.id);
  if (result.changed) {
    console.log(
      `[enforce-limits] sub ${subscription.id}: ${result.previous} -> ${result.decision.restriction} ` +
        `(${Number(totalEvents)}/${included} events, ${result.websitesBlocked} blocked, ${result.websitesUnblocked} unblocked)`,
    );
  }
  return { warned, blocked: result.websitesBlocked, unblocked: result.websitesUnblocked };
}

/** Spending protection emails for a pay-as-you-go period, each once per period. */
async function sendSpendCapEmails(period: any, subscription: any): Promise<void> {
  const plan = subscription.plan;
  const user = subscription.user;
  const usage = usageWithCap(plan, subscription, period);
  const cap = resolveSpendCap(plan, subscription);
  if (!cap.applies || cap.capCents === null) return;
  const ctx = { prisma };

  if (usage.capReached) {
    await notifyOnce(ctx, {
      subscriptionId: subscription.id,
      kind: "spend_cap_reached",
      scopeKey: period.id,
      message: spendCapReachedEmail(user.email, { name: user.name, planName: plan.name, capCents: cap.capCents, periodEnd: period.periodEnd }),
    });
    return;
  }
  if (usage.capApproaching) {
    await notifyOnce(ctx, {
      subscriptionId: subscription.id,
      kind: "spend_cap_approaching",
      scopeKey: period.id,
      message: spendCapApproachingEmail(user.email, {
        name: user.name,
        planName: plan.name,
        currentBillCents: usage.currentBillCents,
        capCents: cap.capCents,
        overageEvents: usage.overageEvents,
      }),
    });
  }
}

async function sendWarningsIfNeeded(
  period: any,
  subscription: any,
  usageRatio: number,
): Promise<boolean> {
  const { lastWarnedThreshold } = period;

  // The highest threshold crossed since the last email: a customer seen first
  // at 95% gets the 90% warning, not the 80% one.
  const isPaygPlan = subscription.plan.overagePricePer1k !== null && subscription.providerSubscriptionId !== null;
  const thresholds = isPaygPlan ? BILLING_CONFIG.usage.warnThresholds.paid : BILLING_CONFIG.usage.warnThresholds.free;
  const nextThreshold = nextThresholdCrossed(usageRatio, thresholds, lastWarnedThreshold ?? null);

  if (!nextThreshold) return false;

  // Update the threshold first to prevent duplicate sends if email fails
  await prisma.billingPeriodUsage.update({
    where: { id: period.id },
    data: { lastWarnedThreshold: nextThreshold },
  });

  const user = subscription.user;
  const isPayg = subscription.plan.overagePricePer1k !== null && subscription.providerSubscriptionId !== null;

  // lastWarnedThreshold is the pointer that drives escalation; the
  // notifications table is the record of what actually went out.
  const kind = nextThreshold >= 1 ? "usage_100" : nextThreshold >= 0.9 ? "usage_90" : "usage_80";
  const outcome = await notifyOnce(
    { prisma },
    {
      subscriptionId: subscription.id,
      kind,
      scopeKey: period.id,
      message: limitWarningEmail(user.email, {
        name: user.name,
        planName: subscription.plan.name,
        totalEvents: Number(period.totalEvents),
        eventLimit: Number(period.includedEvents) || subscription.plan.eventLimit,
        thresholdPercent: nextThreshold * 100,
        // PAYG reads "your bill will grow", free reads "you will be cut off".
        isPayg,
      }),
    },
  );

  console.log(`[enforce-limits] usage warning ${kind} for ${user.email}: ${outcome}`);

  return true;
}
