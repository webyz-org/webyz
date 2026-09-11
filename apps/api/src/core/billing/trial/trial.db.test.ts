/**
 * Trial lifecycle against real Postgres. Run with RUN_DB_TESTS=1.
 * Emails go through the console transport (no provider configured in tests).
 */
import "dotenv/config";
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma/client.js";
import type { AppContext } from "../../../lib/context.js";
import { BILLING_CONFIG } from "../catalog/billing.config.js";
import { PLAN_CATALOG, planRowFromCatalog } from "../catalog/index.js";
import { FakeBillingProvider } from "../provider/fake.provider.js";
import { setBillingProvider } from "../provider/index.js";
import { syncSubscription } from "../subscription/lifecycle.service.js";
import { chooseActiveSites, reconcileSitesToLimit } from "../subscription/site-limit.service.js";
import { checkIngestAllowed } from "../../tracker/tracking.service.js";
import { closeRedis } from "../../../lib/redis.js";
import { getUsageSummary } from "../usage/usage.service.js";
import {
  backfillTrials,
  expireTrials,
  sendTrialReminders,
  startSubscriptionForNewUser,
  startTrial,
} from "./trial.service.js";

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const skip = RUN ? false : "set RUN_DB_TESTS=1 with DATABASE_URL to run";

const d = (s: string) => new Date(s);
const NOW = d("2026-09-06T12:00:00Z");
const DAY = 86_400_000;
const noRedis = { get: async () => null, setex: async () => "OK", del: async () => 1 } as unknown as Redis;

let prisma: PrismaClient;
let ctx: AppContext;
const marker = `trial-${randomUUID()}`;
const userIds: string[] = [];

const newUser = async (label: string, createdAt = NOW) => {
  const user = await prisma.user.create({
    data: { name: `${marker} ${label}`, email: `${marker}-${label}@example.test`, provider: "email", createdAt },
  });
  userIds.push(user.id);
  return user;
};
const addSite = (userId: string, label: string, createdAt: Date) =>
  prisma.website.create({ data: { name: label, domain: `${marker}-${label}.example.test`, userId, createdAt } });

const live = (userId: string) =>
  prisma.subscription.findFirstOrThrow({
    where: { userId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"] } },
    include: { plan: true },
  });
const notifications = (subscriptionId: string) =>
  prisma.billingNotification.findMany({ where: { subscriptionId }, orderBy: { sentAt: "asc" } });

before(async () => {
  if (!RUN) return;
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  ctx = { prisma, redis: noRedis, clickhouse: {} as never };
  for (const code of ["free", "growth"] as const) {
    const def = PLAN_CATALOG.find((p) => p.code === code)!;
    await prisma.plan.upsert({ where: { code }, update: {}, create: planRowFromCatalog(def, 0) });
  }
});

beforeEach(() => {
  if (RUN) setBillingProvider(null);
});

after(async () => {
  // The ingest guard import opens the realtime publisher's Redis connection
  // at module load, whether or not the DB tests run. Close it or the runner
  // never exits.
  await closeRedis();
  if (!RUN) return;
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  await prisma.$disconnect();
});

test("new account starts a Growth trial with a single usage period covering the trial", { skip }, async () => {
  const user = await newUser("signup");
  const sub = await startSubscriptionForNewUser(ctx, user.id, NOW);
  assert.ok(sub);
  const row = await live(user.id);
  assert.equal(row.status, "TRIALING");
  assert.equal(row.plan.code, BILLING_CONFIG.trial.planCode);
  assert.equal(row.providerSubscriptionId, null);
  assert.equal(row.trialStartsAt?.getTime(), NOW.getTime());
  assert.equal(row.trialEndsAt?.getTime(), NOW.getTime() + BILLING_CONFIG.trial.days * DAY);
  assert.equal(row.currentPeriodStart?.getTime(), NOW.getTime());
  assert.equal(row.currentPeriodEnd?.getTime(), row.trialEndsAt?.getTime());
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).trialUsedAt?.getTime(), NOW.getTime());
  const sent = await notifications(row.id);
  assert.deepEqual(sent.map((n) => n.kind), ["trial_started"]);

  // Entitlements are the trial plan's, and the usage summary exposes the trial.
  const summary = await getUsageSummary(ctx, user.id, new Date(NOW.getTime() + 2 * DAY));
  assert.equal(summary.access.state, "TRIAL");
  assert.equal(summary.trial?.daysRemaining, BILLING_CONFIG.trial.days - 2);
  assert.equal(summary.trial?.fallbackPlanName, "Free");
  assert.equal(summary.usage.includedEvents, 500_000);
});

test("a second trial is never granted; a user who had one gets Free", { skip }, async () => {
  const user = await newUser("twice");
  await startTrial(ctx, user.id, NOW);
  assert.equal(await startTrial(ctx, user.id, new Date(NOW.getTime() + DAY)), null);
  await prisma.subscription.updateMany({ where: { userId: user.id }, data: { status: "CANCELED" } });
  const again = await startSubscriptionForNewUser(ctx, user.id, new Date(NOW.getTime() + DAY));
  assert.equal(again?.status, "ACTIVE");
  assert.equal((await live(user.id)).plan.isFree, true);
});

test("trial to paid: checkout sync retires the trial and lands on the paid plan", { skip }, async () => {
  const user = await newUser("upgrade");
  await startTrial(ctx, user.id, NOW);
  const fake = new FakeBillingProvider({ now: () => NOW });
  setBillingProvider(fake);
  const growth = await prisma.plan.findUniqueOrThrow({ where: { code: "growth" } });
  const priceM = `price_m_${marker}`;
  fake.registerPrice(priceM, "month");
  const saved = { m: growth.providerPriceMonthlyId, y: growth.providerPriceYearlyId };
  await prisma.plan.update({ where: { id: growth.id }, data: { providerPriceMonthlyId: priceM } });
  try {
    const { customerId } = await fake.createCustomer({ email: `${marker}-upgrade@example.test`, userId: user.id });
    await prisma.user.update({ where: { id: user.id }, data: { providerCustomerId: customerId } });
    const providerSub = fake.completeCheckout({ customerId, basePriceId: priceM, metadata: { userId: user.id, planId: growth.id }, start: NOW });
    await syncSubscription(ctx, fake, providerSub);
    const rows = await prisma.subscription.findMany({ where: { userId: user.id } });
    assert.equal(rows.filter((r) => r.status === "TRIALING").length, 0, "trial retired");
    const paid = await live(user.id);
    assert.equal(paid.providerSubscriptionId, providerSub.id);
    assert.equal(paid.status, "ACTIVE");
    // An expired trial can never be charged: nothing local ever creates a provider subscription.
    assert.equal(fake.calls.filter((c) => c.method === "startCheckout").length, 0);
  } finally {
    await prisma.plan.update({ where: { id: growth.id }, data: { providerPriceMonthlyId: saved.m, providerPriceYearlyId: saved.y } });
  }
});

test("reminders at 7 and 3 days go out once each, and the countdown never repeats", { skip }, async () => {
  const user = await newUser("remind");
  const sub = (await startTrial(ctx, user.id, NOW))!;
  const endsAt = sub.trialEndsAt!;

  const kinds = async () => (await notifications(sub.id)).map((n) => n.kind);
  await sendTrialReminders(ctx, new Date(endsAt.getTime() - 10 * DAY), { userIds: [user.id] });
  assert.deepEqual(await kinds(), ["trial_started"], "nothing at 10 days");
  await sendTrialReminders(ctx, new Date(endsAt.getTime() - 7 * DAY), { userIds: [user.id] });
  assert.deepEqual(await kinds(), ["trial_started", "trial_reminder_7d"]);
  await sendTrialReminders(ctx, new Date(endsAt.getTime() - 6 * DAY), { userIds: [user.id] });
  assert.deepEqual(await kinds(), ["trial_started", "trial_reminder_7d"], "7 day reminder not repeated");
  await sendTrialReminders(ctx, new Date(endsAt.getTime() - 3 * DAY + 3_600_000), { userIds: [user.id] });
  assert.deepEqual(await kinds(), ["trial_started", "trial_reminder_7d", "trial_reminder_3d"]);
  await sendTrialReminders(ctx, new Date(endsAt.getTime() - DAY), { userIds: [user.id] });
  assert.deepEqual(await kinds(), ["trial_started", "trial_reminder_7d", "trial_reminder_3d"], "nothing repeats");
});

test("a trial first seen at 2 days left gets only the 3 day reminder", { skip }, async () => {
  const user = await newUser("late");
  const sub = (await startTrial(ctx, user.id, NOW))!;
  await sendTrialReminders(ctx, new Date(sub.trialEndsAt!.getTime() - 2 * DAY), { userIds: [user.id] });
  const kinds = (await notifications(sub.id)).map((n) => n.kind);
  assert.deepEqual(kinds, ["trial_started", "trial_reminder_3d"]);
});

test("expiry: trial to Free, excess sites made inactive oldest-first, nothing deleted, one email", { skip }, async () => {
  const user = await newUser("expire");
  const oldest = await addSite(user.id, "a", d("2026-09-06T13:00:00Z"));
  const middle = await addSite(user.id, "b", d("2026-09-07T13:00:00Z"));
  const newest = await addSite(user.id, "c", d("2026-09-08T13:00:00Z"));
  const trial = (await startTrial(ctx, user.id, NOW))!;

  const status = async () => (await prisma.subscription.findUniqueOrThrow({ where: { id: trial.id } })).status;
  await expireTrials(ctx, new Date(trial.trialEndsAt!.getTime() - 1), { userIds: [user.id] });
  assert.equal(await status(), "TRIALING", "not before the end");
  await expireTrials(ctx, trial.trialEndsAt!, { userIds: [user.id] });
  assert.equal(await status(), "CANCELED");
  await expireTrials(ctx, trial.trialEndsAt!, { userIds: [user.id] });
  assert.equal(await prisma.subscription.count({ where: { userId: user.id, status: "ACTIVE" } }), 1, "idempotent: one free row");

  const now = await live(user.id);
  assert.equal(now.plan.isFree, true);
  assert.equal(now.status, "ACTIVE");
  assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: trial.id } })).status, "CANCELED");

  const sites = await prisma.website.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  assert.equal(sites.length, 3, "no site deleted");
  assert.deepEqual(sites.map((s) => [s.id === oldest.id ? "a" : s.id === middle.id ? "b" : "c", s.isActive, s.restrictionReason]), [
    ["a", true, null],
    ["b", false, "TRIAL_ENDED"],
    ["c", false, "TRIAL_ENDED"],
  ]);

  // Ingest: active site allowed, inactive sites refused with a clear code.
  assert.deepEqual(await checkIngestAllowed(ctx, oldest.id), { allowed: true });
  const refused = await checkIngestAllowed(ctx, newest.id);
  assert.equal(refused.allowed, false);
  assert.equal(!refused.allowed && refused.code, "site_inactive");

  const kinds = (await notifications(trial.id)).map((n) => n.kind);
  assert.ok(kinds.includes("trial_expired"));
  assert.equal(kinds.filter((k) => k === "trial_expired").length, 1);

  // The summary tells the customer which sites are inactive and why.
  const summary = await getUsageSummary(ctx, user.id, trial.trialEndsAt!);
  assert.equal(summary.sites.limit, 1);
  assert.equal(summary.sites.active, 1);
  assert.deepEqual(summary.sites.inactive.map((s) => s.reason), ["TRIAL_ENDED", "TRIAL_ENDED"]);

  // Customer picks a different active site; the previous one becomes inactive.
  await chooseActiveSites(ctx, user.id, [newest.id]);
  const after = await prisma.website.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(after.map((s) => s.isActive), [false, false, true]);
  assert.equal(after[0].restrictionReason, "CUSTOMER_CHOICE");
  await assert.rejects(chooseActiveSites(ctx, user.id, [oldest.id, newest.id]), /allows 1 active website/);
  await assert.rejects(chooseActiveSites(ctx, user.id, [randomUUID()]), /Site not found/);

  // Reconcile again keeps the customer's choice (active first, then oldest).
  const r = await reconcileSitesToLimit(ctx, user.id, "TRIAL_ENDED");
  assert.equal(r.restricted.length, 0);
  assert.equal(r.activated.length, 0);
  assert.equal((await prisma.website.findUniqueOrThrow({ where: { id: newest.id } })).isActive, true);
});

test("rollout backfill: recent accounts get a trial, older ones do not, and it is idempotent", { skip }, async () => {
  const window = BILLING_CONFIG.trial.grantToAccountsCreatedWithinDays;
  const recent = await newUser("recent", new Date(NOW.getTime() - (window - 2) * DAY));
  const old = await newUser("old", new Date(NOW.getTime() - (window + 2) * DAY));
  // Both existed on Free before trials shipped.
  await prisma.subscription.create({ data: { userId: recent.id, planId: (await prisma.plan.findUniqueOrThrow({ where: { code: "free" } })).id, status: "ACTIVE", currentPeriodStart: NOW, currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY) } });
  await prisma.subscription.create({ data: { userId: old.id, planId: (await prisma.plan.findUniqueOrThrow({ where: { code: "free" } })).id, status: "ACTIVE", currentPeriodStart: NOW, currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY) } });

  const started = await backfillTrials(ctx, NOW, { userIds: [recent.id, old.id] });
  assert.ok(started >= 1);
  assert.equal((await live(recent.id)).status, "TRIALING");
  assert.equal((await live(old.id)).plan.isFree, true);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: old.id } })).trialUsedAt, null);

  // Second run grants nothing to these two.
  await backfillTrials(ctx, NOW, { userIds: [recent.id, old.id] });
  assert.equal(await prisma.subscription.count({ where: { userId: recent.id, status: "TRIALING" } }), 1);
});
