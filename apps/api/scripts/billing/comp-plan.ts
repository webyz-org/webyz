/**
 * Operator override: mark an account's live local-only paid subscription as
 * comped, or take the comp away.
 *
 *   npx tsx scripts/billing/comp-plan.ts --email <account email> --note "<why>"
 *   npx tsx scripts/billing/comp-plan.ts --email <account email> --off
 *
 * A paid plan with no provider subscription is a hard limit, because overage
 * cannot be billed without a card: right for a trial, wrong for a plan given
 * away, which would otherwise be paused at its allowance like Free. A comped
 * row keeps the plan's entitlements, is never quota-blocked and never billed.
 * It refuses a provider-backed row (that customer pays, overage is billed)
 * and a free or trial row. Every use is a deliberate exception, which is why
 * it is a script and not an endpoint.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.js";
import { redis } from "../../src/lib/redis.js";
import { invalidateEntitlements, LIVE_STATUSES } from "../../src/core/billing/entitlements/entitlement.service.js";
import { reconcileRestriction } from "../../src/core/billing/state/restriction.service.js";

const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const email = arg("--email");
const note = arg("--note");
const off = process.argv.includes("--off");
if (!email || (!off && !note)) {
  console.error('Pass --email <account email> and either --note "<why>" or --off');
  process.exit(2);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const ctx = { prisma, redis };

const main = async () => {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) throw new Error(`no account with email ${email}`);

  // The same row every billing decision reads: the newest live subscription.
  const sub = await prisma.subscription.findFirst({
    where: { userId: user.id, status: { in: [...LIVE_STATUSES] } },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });
  if (!sub) throw new Error(`${user.email} has no live subscription`);
  if (sub.providerSubscriptionId) throw new Error(`${sub.id} is provider-backed (${sub.providerSubscriptionId}); a paying subscription is not comped`);
  if (sub.plan.isFree) throw new Error(`${sub.id} is on the free plan; comp a paid plan`);
  if (sub.status !== "ACTIVE") throw new Error(`${sub.id} is ${sub.status}; only an ACTIVE row can be comped`);

  await prisma.subscription.update({
    where: { id: sub.id },
    data: off ? { compedAt: null, compNote: null } : { compedAt: new Date(), compNote: note },
  });

  const result = await reconcileRestriction(ctx, user.id);
  await invalidateEntitlements(ctx, user.id);
  console.log(
    `${off ? "uncomped" : "comped"} ${sub.plan.code} ${sub.billingCycle} ${sub.id} for ${user.email}; ` +
      `restriction ${result.previous} -> ${result.decision.restriction}, ` +
      `${result.websitesUnblocked} site(s) unblocked, ${result.websitesBlocked} blocked`,
  );
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
