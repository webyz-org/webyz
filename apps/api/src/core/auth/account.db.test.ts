/**
 * Account deletion against Postgres, with a fake billing provider and a stub
 * ClickHouse. Run with RUN_DB_TESTS=1. Rows carry a unique marker and are
 * removed afterwards; nothing job-wide runs.
 */
import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import type { AppContext } from "../../lib/context.js";
import { closeRedis } from "../../lib/redis.js";
import { PLAN_CATALOG, planRowFromCatalog } from "../billing/catalog/index.js";
import { FakeBillingProvider } from "../billing/provider/fake.provider.js";
import { setBillingProvider } from "../billing/provider/index.js";
import { startSubscriptionForNewUser } from "../billing/trial/trial.service.js";
import { hashPassword } from "./password.service.js";
import { createApiKey } from "./api-keys.service.js";
import { deleteAccount, exportAccountData } from "./account.service.js";
import { hashEmail } from "./email-hash.js";

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const skip = RUN ? false : "set RUN_DB_TESTS=1 with DATABASE_URL to run";

const marker = `acct-${randomUUID().slice(0, 8)}`;
let prisma: PrismaClient;
let ctx: AppContext;
const emails: string[] = [];

const memoryRedis = () => {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _ttl: number, v: string) => (store.set(k, v), "OK"),
    set: async (k: string, v: string, ...args: unknown[]) => {
      if (args.includes("NX") && store.has(k)) return null;
      store.set(k, v);
      return "OK";
    },
    del: async (...keys: string[]) => keys.reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0),
    expire: async () => 1,
  } as unknown as Redis;
};

/** Records every mutation instead of running it. */
const stubClickhouse = () => {
  const commands: string[] = [];
  return {
    commands,
    client: { command: async ({ query }: { query: string }) => void commands.push(query) } as never,
  };
};

const newUser = async (label: string, password: string | null) => {
  const email = `${marker}-${label}@example.test`;
  emails.push(email);
  return prisma.user.create({
    data: { name: `${marker} ${label}`, email, provider: password ? "email" : "google", password: password ? await hashPassword(password) : null },
  });
};

before(async () => {
  if (!RUN) return;
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  for (const code of ["free", "growth"] as const) {
    const def = PLAN_CATALOG.find((p) => p.code === code)!;
    await prisma.plan.upsert({ where: { code }, update: {}, create: planRowFromCatalog(def, 0) });
  }
});

after(async () => {
  await closeRedis();
  if (!RUN) return;
  await prisma.user.deleteMany({ where: { email: { in: emails } } }).catch(() => {});
  await prisma.deletedAccount.deleteMany({ where: { emailHash: { in: emails.map(hashEmail) } } }).catch(() => {});
  await prisma.$disconnect();
});

test("delete: wrong password refuses and leaves everything in place", { skip }, async () => {
  const ch = stubClickhouse();
  ctx = { prisma, redis: memoryRedis(), clickhouse: ch.client };
  const user = await newUser("wrongpw", "correct-horse-8");
  await startSubscriptionForNewUser(ctx, user.id);

  await assert.rejects(deleteAccount(ctx, user.id, { password: "nope-nope-8" }), /incorrect/);
  await assert.rejects(deleteAccount(ctx, user.id, {}), /Enter your password/);
  assert.ok(await prisma.user.findUnique({ where: { id: user.id } }));
  assert.equal(ch.commands.length, 0);
});

test("delete: removes the row and everything under it, purges ClickHouse, leaves a tombstone", { skip }, async () => {
  const ch = stubClickhouse();
  ctx = { prisma, redis: memoryRedis(), clickhouse: ch.client };
  const user = await newUser("full", "correct-horse-8");
  await startSubscriptionForNewUser(ctx, user.id); // Growth trial: sets trialUsedAt, allows api_access
  const site = await prisma.website.create({ data: { name: "s", domain: `${marker}-full.example.test`, userId: user.id } });
  await prisma.goal.create({ data: { websiteId: site.id, name: "Signup", eventName: "signup" } });
  const { key } = await createApiKey(ctx, user.id, "ci");

  const exported = await exportAccountData(ctx, user.id);
  assert.equal(exported.account.email, user.email);
  assert.equal(exported.websites.length, 1);
  assert.equal(exported.websites[0].goals.length, 1);
  assert.equal(exported.apiKeys[0].keyPrefix, key.keyPrefix);
  assert.equal(exported.subscriptions[0].planCode, "growth");
  assert.ok(!("providerCustomerId" in exported.account));

  const result = await deleteAccount(ctx, user.id, { password: "correct-horse-8" });
  assert.deepEqual(result, { deleted: true });

  assert.equal(await prisma.user.findUnique({ where: { id: user.id } }), null);
  assert.equal(await prisma.website.findUnique({ where: { id: site.id } }), null);
  assert.equal(await prisma.apiKey.count({ where: { id: key.id } }), 0);
  assert.equal(await prisma.subscription.count({ where: { userId: user.id } }), 0);

  // events, sessions, event_data, hourly_aggregates, each by website_id.
  assert.equal(ch.commands.length, 4);
  assert.ok(ch.commands.every((q) => q.includes("DELETE WHERE website_id")));

  const tomb = await prisma.deletedAccount.findUnique({ where: { emailHash: hashEmail(user.email) } });
  assert.ok(tomb);
  assert.ok(tomb.trialUsedAt);
  assert.equal(tomb.hadPaidSubscription, false);
});

test("re-registering a deleted address gets the free plan, not a second trial", { skip }, async () => {
  ctx = { prisma, redis: memoryRedis(), clickhouse: stubClickhouse().client };
  const first = await newUser("again", null);
  await startSubscriptionForNewUser(ctx, first.id);
  await deleteAccount(ctx, first.id, {});

  const second = await prisma.user.create({
    data: { name: "again", email: first.email, provider: "google" },
  });
  await startSubscriptionForNewUser(ctx, second.id);
  const sub = await prisma.subscription.findFirstOrThrow({ where: { userId: second.id }, include: { plan: true } });
  assert.equal(sub.plan.code, "free");
  assert.notEqual(sub.status, "TRIALING");
});

test("delete: a live paid subscription is cancelled at the provider first", { skip }, async () => {
  const fake = new FakeBillingProvider();
  fake.registerPrice("price_base", "month");
  setBillingProvider(fake);
  ctx = { prisma, redis: memoryRedis(), clickhouse: stubClickhouse().client };

  const user = await newUser("paid", null);
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "growth" } });
  const providerSub = fake.completeCheckout({ customerId: "cus_x", basePriceId: "price_base" });
  await prisma.subscription.create({
    data: { userId: user.id, planId: plan.id, status: "ACTIVE", providerSubscriptionId: providerSub.id },
  });

  await deleteAccount(ctx, user.id, {});

  assert.equal(fake.calls.filter((c) => c.method === "cancelNow").length, 1);
  assert.equal(fake.subscriptions.get(providerSub.id)?.status, "canceled");
  assert.equal(await prisma.user.findUnique({ where: { id: user.id } }), null);
  const tomb = await prisma.deletedAccount.findUnique({ where: { emailHash: hashEmail(user.email) } });
  assert.equal(tomb?.hadPaidSubscription, true);
  setBillingProvider(null);
});

test("delete: a provider refusal aborts and nothing is deleted", { skip }, async () => {
  const fake = new FakeBillingProvider();
  setBillingProvider(fake);
  ctx = { prisma, redis: memoryRedis(), clickhouse: stubClickhouse().client };

  const user = await newUser("refused", null);
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "growth" } });
  // The fake knows no such subscription, so cancelNow throws, as the provider would
  // for a subscription it cannot cancel.
  await prisma.subscription.create({
    data: { userId: user.id, planId: plan.id, status: "ACTIVE", providerSubscriptionId: "sub_unknown_to_provider" },
  });

  await assert.rejects(deleteAccount(ctx, user.id, {}), /could not be cancelled/);
  assert.ok(await prisma.user.findUnique({ where: { id: user.id } }));
  assert.equal(await prisma.deletedAccount.findUnique({ where: { emailHash: hashEmail(user.email) } }), null);
  setBillingProvider(null);
});
