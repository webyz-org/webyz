/**
 * Email verification against Postgres. Run with RUN_DB_TESTS=1. The functions
 * take `requireVerification` explicitly so both modes are exercised whatever
 * the environment says. Rows carry a unique marker and are removed afterwards.
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
import { setBillingProvider } from "../billing/provider/index.js";
import { loginUser, registerUser } from "./users.service.js";
import { resendVerification, verifyEmail } from "./email-verification.service.js";
import { hashEmail } from "./email-hash.js";

const RUN = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const skip = RUN ? false : "set RUN_DB_TESTS=1 with DATABASE_URL to run";

const marker = `verify-${randomUUID().slice(0, 8)}`;
let prisma: PrismaClient;
let ctx: AppContext;
const emails: string[] = [];

const memoryRedis = () => {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _ttl: number, v: string) => (store.set(k, v), "OK"),
    set: async (k: string, v: string) => (store.set(k, v), "OK"),
    del: async (...keys: string[]) => keys.reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0),
  } as unknown as Redis;
};

const email = (label: string) => {
  const e = `${marker}-${label}@example.test`;
  emails.push(e);
  return e;
};

const livePlan = (userId: string) =>
  prisma.subscription.findFirstOrThrow({
    where: { userId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"] } },
    include: { plan: true },
  });

const latestToken = async (userId: string) =>
  prisma.emailVerificationToken.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });

before(async () => {
  if (!RUN) return;
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  ctx = { prisma, redis: memoryRedis(), clickhouse: {} as never };
  setBillingProvider(null);
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

test("verification required: signup is Free and unverified, login is refused, the link verifies and starts the trial", { skip }, async () => {
  const e = email("required");
  const user = await registerUser(ctx, { name: "V", email: e, password: "longenough1" }, { requireVerification: true });
  assert.equal(user.requiresVerification, true);

  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(row.emailVerifiedAt, null);
  assert.equal((await livePlan(user.id)).plan.code, "free");

  await assert.rejects(
    loginUser(ctx, { email: e, password: "longenough1" }, { requireVerification: true }),
    (err: { code?: string }) => err.code === "EMAIL_NOT_VERIFIED",
  );
  // Wrong password still says wrong password, never "unverified".
  await assert.rejects(
    loginUser(ctx, { email: e, password: "wrongwrong1" }, { requireVerification: true }),
    (err: { code?: string }) => err.code === "UNAUTHORIZED",
  );

  // The service stores only the hash, so redeem through a freshly issued token
  // whose plaintext we can reconstruct: resend, then read the stored hash and
  // compare against the token we derive is impossible; instead exercise
  // verifyEmail with a bad token first, then with a token we plant.
  await assert.rejects(verifyEmail(ctx, "not-a-real-token"), /invalid or has expired/);

  const { createHash, randomBytes } = await import("node:crypto");
  const plain = randomBytes(32).toString("base64url");
  await prisma.emailVerificationToken.create({
    data: { userId: user.id, tokenHash: createHash("sha256").update(plain).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
  });

  const verified = await verifyEmail(ctx, plain);
  assert.equal(verified.id, user.id);
  assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt);
  assert.equal((await livePlan(user.id)).plan.code, "growth");
  assert.equal((await livePlan(user.id)).status, "TRIALING");

  // Single use.
  await assert.rejects(verifyEmail(ctx, plain), /invalid or has expired/);

  // Login works now.
  const logged = await loginUser(ctx, { email: e, password: "longenough1" }, { requireVerification: true });
  assert.equal(logged.id, user.id);
});

test("verification off: signup is verified immediately and gets the trial", { skip }, async () => {
  const e = email("off");
  const user = await registerUser(ctx, { name: "V", email: e, password: "longenough1" }, { requireVerification: false });
  assert.equal(user.requiresVerification, false);
  assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt);
  assert.equal((await livePlan(user.id)).plan.code, "growth");
});

test("resend never reveals whether an address exists, and only unverified password accounts get a token", { skip }, async () => {
  const e = email("resend");
  const user = await registerUser(ctx, { name: "V", email: e, password: "longenough1" }, { requireVerification: true });
  const before = (await latestToken(user.id)).id;

  await resendVerification(ctx, e);
  const afterResend = await latestToken(user.id);
  assert.notEqual(afterResend.id, before);
  assert.ok((await prisma.emailVerificationToken.findUniqueOrThrow({ where: { id: before } })).usedAt, "older token retired");

  await resendVerification(ctx, `${marker}-nobody@example.test`); // resolves silently
  const count = await prisma.emailVerificationToken.count({ where: { userId: user.id } });
  assert.equal(count, 2);
});
