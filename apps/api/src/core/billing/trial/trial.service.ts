import { hashEmail } from "../../auth/email-hash.js";
import type { AppContext } from "../../../lib/context.js";
import { BILLING_CONFIG } from "../catalog/billing.config.js";
import { parseEntitlements } from "../catalog/entitlements.schema.js";
import { invalidateEntitlements, LIVE_STATUSES } from "../entitlements/entitlement.service.js";
import { assignFreePlan } from "../free-plan.service.js";
import { notifyOnce } from "../notifications/notification.service.js";
import { reconcileRestriction } from "../state/restriction.service.js";
import { reconcileSitesToLimit } from "../subscription/site-limit.service.js";
import {
  trialExpiredEmail,
  trialReminderEmail,
  trialStartedEmail,
} from "../../email/templates/index.js";

type Deps = Pick<AppContext, "prisma" | "redis">;

/** Restrict a job-wide function to these users. Production runs unscoped. */
export type JobScope = { userIds?: string[] };
const userScope = (scope?: JobScope) => (scope?.userIds ? { userId: { in: scope.userIds } } : {});
const idScope = (scope?: JobScope) => (scope?.userIds ? { id: { in: scope.userIds } } : {});

const DAY = 86_400_000;

/**
 * Trial rules, pure. `eligible` decides at signup; `eligibleAtRollout`
 * decides for accounts that existed before trials shipped.
 */
export const trialConfig = () => BILLING_CONFIG.trial;

export const isTrialEligible = (user: { trialUsedAt: Date | null }, hasPaidSubscription: boolean) =>
  trialConfig().enabled && user.trialUsedAt === null && !hasPaidSubscription;

export const isRolloutEligible = (
  user: { trialUsedAt: Date | null; createdAt: Date },
  hasPaidSubscription: boolean,
  now: Date,
) =>
  isTrialEligible(user, hasPaidSubscription) &&
  now.getTime() - user.createdAt.getTime() <= trialConfig().grantToAccountsCreatedWithinDays * DAY;

export const trialEndFor = (start: Date) => new Date(start.getTime() + trialConfig().days * DAY);

export const daysRemaining = (endsAt: Date, now: Date) => Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / DAY));

/**
 * Put a user on a trial of the configured plan. Retires the free row, sets
 * trialUsedAt so it can never happen twice, and sends the welcome email once.
 * Returns null (and does nothing) when the user is not eligible.
 */
export const startTrial = async (ctx: Deps, userId: string, now = new Date()) => {
  const { prisma } = ctx;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, trialUsedAt: true, createdAt: true },
  });
  if (!user) return null;

  // Any provider-backed subscription, live or past, means this account has
  // paid before: a churned customer is not a trial candidate.
  const paid = await prisma.subscription.count({
    where: { userId, providerSubscriptionId: { not: null } },
  });
  if (!isTrialEligible(user, paid > 0)) return null;

  // A deleted account that already used its trial (or paid) leaves a tombstone
  // keyed by email hash; re-registering with the same address is not a new
  // customer. See core/auth/account.service.ts.
  const tombstone = await prisma.deletedAccount.findUnique({ where: { emailHash: hashEmail(user.email) } });
  if (tombstone && (tombstone.trialUsedAt || tombstone.hadPaidSubscription)) return null;

  const plan = await prisma.plan.findUnique({ where: { code: trialConfig().planCode } });
  if (!plan) {
    console.error(`[trial] trial plan "${trialConfig().planCode}" is missing; run prisma:seed`);
    return null;
  }

  const endsAt = trialEndFor(now);
  const sub = await prisma.$transaction(async (tx) => {
    // Claim eligibility first: a concurrent signup path cannot start two.
    const claimed = await tx.user.updateMany({ where: { id: userId, trialUsedAt: null }, data: { trialUsedAt: now } });
    if (claimed.count === 0) return null;

    await tx.subscription.updateMany({
      where: { userId, status: { in: [...LIVE_STATUSES] }, providerSubscriptionId: null },
      data: { status: "CANCELED", canceledAt: now },
    });

    return tx.subscription.create({
      data: {
        userId,
        planId: plan.id,
        status: "TRIALING",
        billingCycle: "MONTHLY",
        trialStartsAt: now,
        trialEndsAt: endsAt,
        // The trial is one usage period: allowance for the whole trial.
        currentPeriodStart: now,
        currentPeriodEnd: endsAt,
        basePeriodStart: now,
        basePeriodEnd: endsAt,
      },
    });
  });
  if (!sub) return null;

  // A fresh allowance: sites blocked under the free quota come back on.
  await reconcileRestriction(ctx, userId, now);
  await invalidateEntitlements(ctx, userId);
  const ents = parseEntitlements(plan.entitlements);
  await notifyOnce(ctx, {
    subscriptionId: sub.id,
    kind: "trial_started",
    scopeKey: sub.id,
    message: trialStartedEmail(user.email, {
      name: user.name,
      planName: plan.name,
      days: trialConfig().days,
      endsAt,
      includedEvents: ents.events_per_period,
      sites: ents.sites,
    }),
  });
  console.log(`[trial] started ${plan.code} trial for user ${userId} until ${endsAt.toISOString()}`);
  return sub;
};

/**
 * New account: trial if eligible, otherwise the free plan. The one entry point
 * signup paths call.
 */
export const startSubscriptionForNewUser = async (ctx: Deps, userId: string, now = new Date()) => {
  // Signup must not fail, and the account must not be left without a row, for
  // a billing-side error. Fall back to Free; if even that fails, the hourly
  // sync's backfillFreePlans repairs it, and until then the account behaves as
  // free (deriveAccess(null)) with nothing blocked.
  try {
    const trial = await startTrial(ctx, userId, now);
    if (trial) return trial;
  } catch (err) {
    console.error(`[trial] could not start a trial for user ${userId}, falling back to Free:`, err);
  }
  try {
    return await assignFreePlan({ prisma: ctx.prisma }, userId);
  } catch (err) {
    console.error(`[free-plan] could not assign the free plan to user ${userId}; the hourly backfill will repair it:`, err);
    return null;
  }
};

/**
 * Rollout: accounts created within the configured window that never had a
 * trial get one. Idempotent through trialUsedAt. Runs with the hourly sync.
 */
export const backfillTrials = async (ctx: Deps, now = new Date(), scope?: JobScope) => {
  if (!trialConfig().enabled) return 0;
  const since = new Date(now.getTime() - trialConfig().grantToAccountsCreatedWithinDays * DAY);
  const candidates = await ctx.prisma.user.findMany({
    where: {
      ...idScope(scope),
      trialUsedAt: null,
      createdAt: { gte: since },
      // Never paid, in any status: see startTrial.
      subscriptions: { none: { providerSubscriptionId: { not: null } } },
    },
    select: { id: true, trialUsedAt: true, createdAt: true },
  });
  let started = 0;
  for (const user of candidates) {
    if (!isRolloutEligible(user, false, now)) continue;
    if (await startTrial(ctx, user.id, now)) started += 1;
  }
  if (started) console.log(`[trial] rollout granted ${started} trial(s)`);
  return started;
};

/** 7 and 3 day reminders, each once per trial. */
export const sendTrialReminders = async (ctx: Deps, now = new Date(), scope?: JobScope) => {
  const { prisma } = ctx;
  const horizon = Math.max(...trialConfig().reminderDaysBefore);
  const trials = await prisma.subscription.findMany({
    where: {
      ...userScope(scope),
      status: "TRIALING",
      providerSubscriptionId: null,
      trialEndsAt: { gt: now, lte: new Date(now.getTime() + horizon * DAY) },
    },
    include: { plan: true, user: { select: { email: true, name: true, websites: { select: { id: true } } } } },
  });
  const free = await prisma.plan.findFirst({ where: { isFree: true } });
  if (!free) return 0;
  const freeEnts = parseEntitlements(free.entitlements);

  let sent = 0;
  for (const t of trials) {
    const left = daysRemaining(t.trialEndsAt!, now);
    // Only the most urgent reminder whose threshold has been reached: a trial
    // first seen at 2 days left gets the 3 day email, not the 7 day one too.
    const most = [...trialConfig().reminderDaysBefore].sort((a, b) => a - b).find((d) => left <= d);
    const due = most === undefined ? [] : [most];
    const kindFor = (d: number): "trial_reminder_7d" | "trial_reminder_3d" =>
      d === 7 ? "trial_reminder_7d" : "trial_reminder_3d";
    for (const d of due) {
      const outcome = await notifyOnce(ctx, {
        subscriptionId: t.id,
        kind: kindFor(d),
        scopeKey: t.id,
        message: trialReminderEmail(t.user.email, {
          name: t.user.name,
          planName: t.plan.name,
          daysLeft: left,
          endsAt: t.trialEndsAt!,
          freeSites: freeEnts.sites,
          freeEvents: freeEnts.events_per_period,
          sitesOverFreeLimit: Math.max(0, t.user.websites.length - freeEnts.sites),
        }),
      });
      if (outcome === "sent") sent += 1;
    }
  }
  return sent;
};

/**
 * Trials past their end date move to Free. Nothing is deleted: sites beyond
 * the free limit are made inactive (oldest stay active) and the customer is
 * told which ones and how to change it.
 */
export const expireTrials = async (ctx: Deps, now = new Date(), scope?: JobScope) => {
  const { prisma } = ctx;
  const expired = await prisma.subscription.findMany({
    where: { ...userScope(scope), status: "TRIALING", providerSubscriptionId: null, trialEndsAt: { lte: now } },
    include: { plan: true, user: { select: { id: true, email: true, name: true } } },
  });

  let count = 0;
  for (const t of expired) {
    await prisma.subscription.update({
      where: { id: t.id },
      data: { status: "CANCELED", canceledAt: now, restriction: "NONE", restrictedAt: null },
    });
    const free = await assignFreePlan({ prisma }, t.user.id);
    if (!free) continue;
    await reconcileRestriction(ctx, t.user.id, now);
    await invalidateEntitlements(ctx, t.user.id);

    const { restricted, limit } = await reconcileSitesToLimit(ctx, t.user.id, "TRIAL_ENDED");
    const freePlan = await prisma.plan.findUniqueOrThrow({ where: { id: free.planId } });
    const freeEnts = parseEntitlements(freePlan.entitlements);

    await notifyOnce(ctx, {
      subscriptionId: t.id,
      kind: "trial_expired",
      scopeKey: t.id,
      message: trialExpiredEmail(t.user.email, {
        name: t.user.name,
        planName: t.plan.name,
        freeSites: limit,
        freeEvents: freeEnts.events_per_period,
        restrictedSites: restricted.map((w) => w.domain),
      }),
    });
    count += 1;
    console.log(`[trial] expired for user ${t.user.id}; ${restricted.length} site(s) over the free limit made inactive`);
  }
  return count;
};
