/**
 * Operator override: give one account a fresh trial regardless of the signup
 * rules (one trial per account, never after a paid subscription).
 *
 *   npx tsx scripts/billing/grant-trial.ts --email <account email>
 *
 * Same rows as `startTrial` (core/billing/trial/trial.service.ts): any live
 * local-only subscription is cancelled, a TRIALING row on the configured trial
 * plan is created for the configured number of days as one usage period,
 * restriction and entitlement caches are reconciled. `trialUsedAt` is set to
 * now so the account cannot mint another through signup paths. Use it for
 * goodwill or for an operator's own account after a live test; every use is a
 * deliberate exception, which is why it is a script and not an endpoint.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.js";
import { redis } from "../../src/lib/redis.js";
import { invalidateEntitlements, LIVE_STATUSES } from "../../src/core/billing/entitlements/entitlement.service.js";
import { reconcileRestriction } from "../../src/core/billing/state/restriction.service.js";
import { trialConfig, trialEndFor } from "../../src/core/billing/trial/trial.service.js";

const email = process.argv.includes("--email") ? process.argv[process.argv.indexOf("--email") + 1] : undefined;
if (!email) {
  console.error("Pass --email <account email>");
  process.exit(2);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const ctx = { prisma, redis };

const main = async () => {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) throw new Error(`no account with email ${email}`);

  const plan = await prisma.plan.findUnique({ where: { code: trialConfig().planCode } });
  if (!plan) throw new Error(`trial plan "${trialConfig().planCode}" is missing`);

  const now = new Date();
  const endsAt = trialEndFor(now);

  const sub = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { trialUsedAt: now } });
    const closed = await tx.subscription.updateMany({
      where: { userId: user.id, status: { in: [...LIVE_STATUSES] }, providerSubscriptionId: null },
      data: { status: "CANCELED", canceledAt: now },
    });
    console.log(`closed ${closed.count} live local-only subscription(s)`);
    return tx.subscription.create({
      data: {
        userId: user.id,
        planId: plan.id,
        status: "TRIALING",
        billingCycle: "MONTHLY",
        trialStartsAt: now,
        trialEndsAt: endsAt,
        currentPeriodStart: now,
        currentPeriodEnd: endsAt,
        basePeriodStart: now,
        basePeriodEnd: endsAt,
      },
    });
  });

  await reconcileRestriction(ctx, user.id, now);
  await invalidateEntitlements(ctx, user.id);
  console.log(`granted ${plan.code} trial ${sub.id} to ${user.email} until ${endsAt.toISOString()} (${trialConfig().days} days)`);
};

main()
  .catch((err) => {
    console.error("failed:", err?.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit().catch(() => undefined);
  });
