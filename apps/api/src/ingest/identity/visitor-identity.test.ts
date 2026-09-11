import { test } from "node:test";
import assert from "node:assert/strict";
import type { Redis } from "ioredis";

import {
  SESSION_TIMEOUT_SECONDS,
  getDailySalt,
  identifyVisitor,
  resolveSession,
  saltDay,
  visitorIdFor,
} from "./visitor-identity.js";

/** In-memory Redis with the subset used here: get, set (EX/NX), expire, plus a TTL peek. */
const memoryRedis = () => {
  const store = new Map<string, { value: string; ttl: number | null }>();
  const redis = {
    get: async (k: string) => store.get(k)?.value ?? null,
    set: async (k: string, v: string, ...args: unknown[]) => {
      const nx = args.includes("NX");
      const exAt = args.indexOf("EX");
      const ttl = exAt >= 0 ? Number(args[exAt + 1]) : null;
      if (nx && store.has(k)) return null;
      store.set(k, { value: v, ttl });
      return "OK";
    },
    expire: async (k: string, ttl: number) => {
      const row = store.get(k);
      if (!row) return 0;
      row.ttl = ttl;
      return 1;
    },
  } as unknown as Redis;
  return { redis, store };
};

const brokenRedis = () =>
  ({
    get: async () => {
      throw new Error("ECONNREFUSED");
    },
    set: async () => {
      throw new Error("ECONNREFUSED");
    },
    expire: async () => {
      throw new Error("ECONNREFUSED");
    },
  }) as unknown as Redis;

test("saltDay is the UTC calendar day", () => {
  assert.equal(saltDay(new Date("2026-09-07T23:59:59Z")), "2026-09-07");
  assert.equal(saltDay(new Date("2026-09-08T00:00:00Z")), "2026-09-08");
});

test("visitorIdFor is deterministic and changes with every input", () => {
  const base = visitorIdFor("salt", "site", "1.2.3.4", "UA");
  assert.equal(base, visitorIdFor("salt", "site", "1.2.3.4", "UA"));
  assert.equal(base.length, 32);
  assert.match(base, /^[0-9a-f]{32}$/);

  assert.notEqual(base, visitorIdFor("other-salt", "site", "1.2.3.4", "UA"));
  assert.notEqual(base, visitorIdFor("salt", "other-site", "1.2.3.4", "UA"));
  assert.notEqual(base, visitorIdFor("salt", "site", "1.2.3.5", "UA"));
  assert.notEqual(base, visitorIdFor("salt", "site", "1.2.3.4", "UA2"));
});

test("visitorIdFor cannot be collided by moving characters across field boundaries", () => {
  assert.notEqual(visitorIdFor("s", "ab", "c", "d"), visitorIdFor("s", "a", "bc", "d"));
});

test("getDailySalt creates one salt per day, reuses it, and rotates at midnight", async () => {
  const { redis, store } = memoryRedis();
  const day1 = new Date("2026-09-07T10:00:00Z");
  const day2 = new Date("2026-09-08T10:00:00Z");

  const a = await getDailySalt(redis, day1);
  const b = await getDailySalt(redis, day1);
  const c = await getDailySalt(redis, day2);

  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 64);
  assert.equal(store.get("visitor_salt:2026-09-07")?.ttl, 48 * 60 * 60);
});

test("getDailySalt returns the existing value when another instance claimed the key first", async () => {
  const { redis } = memoryRedis();
  // Simulate a lost race: someone wrote the key between our get and set.
  const original = redis.get.bind(redis);
  let calls = 0;
  (redis as unknown as { get: typeof original }).get = async (k: string) => {
    calls += 1;
    if (calls === 1) {
      await redis.set(k, "winner", "EX", 10, "NX");
      return null;
    }
    return original(k);
  };

  assert.equal(await getDailySalt(redis, new Date("2026-09-07T10:00:00Z")), "winner");
});

test("resolveSession continues within the window and slides the TTL", async () => {
  const { redis, store } = memoryRedis();

  const first = await resolveSession(redis, "site", "visitor");
  assert.equal(first.isNewSession, true);

  const key = "visitor_session:site:visitor";
  store.get(key)!.ttl = 5; // pretend time passed

  const second = await resolveSession(redis, "site", "visitor");
  assert.equal(second.isNewSession, false);
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(store.get(key)?.ttl, SESSION_TIMEOUT_SECONDS);
});

test("resolveSession keeps visitors and sites apart", async () => {
  const { redis } = memoryRedis();
  const a = await resolveSession(redis, "site", "v1");
  const b = await resolveSession(redis, "site", "v2");
  const c = await resolveSession(redis, "other-site", "v1");
  assert.notEqual(a.sessionId, b.sessionId);
  assert.notEqual(a.sessionId, c.sessionId);
});

test("identifyVisitor ties it together: same inputs same day share visitor and session", async () => {
  const { redis } = memoryRedis();
  const input = { websiteId: "site", ip: "9.9.9.9", userAgent: "UA", now: new Date("2026-09-07T10:00:00Z") };

  const first = await identifyVisitor(redis, input);
  const second = await identifyVisitor(redis, input);
  const tomorrow = await identifyVisitor(redis, { ...input, now: new Date("2026-09-08T10:00:00Z") });

  assert.equal(first.visitorId, second.visitorId);
  assert.equal(first.sessionId, second.sessionId);
  assert.equal(first.isNewSession, true);
  assert.equal(second.isNewSession, false);

  // A new day means a new salt, so the person is not linkable to yesterday.
  assert.notEqual(tomorrow.visitorId, first.visitorId);
  assert.equal(tomorrow.isNewSession, true);
});

test("identifyVisitor keeps working without Redis, still rotating daily", async () => {
  const redis = brokenRedis();
  const now = new Date("2026-09-07T10:00:00Z");

  const a = await identifyVisitor(redis, { websiteId: "site", ip: "1.1.1.1", userAgent: "UA", now });
  const b = await identifyVisitor(redis, { websiteId: "site", ip: "1.1.1.1", userAgent: "UA", now });
  const later = await identifyVisitor(redis, {
    websiteId: "site",
    ip: "1.1.1.1",
    userAgent: "UA",
    now: new Date(now.getTime() + 31 * 60 * 1000),
  });
  const nextDay = await identifyVisitor(redis, {
    websiteId: "site",
    ip: "1.1.1.1",
    userAgent: "UA",
    now: new Date("2026-09-08T10:00:00Z"),
  });

  assert.equal(a.visitorId, b.visitorId);
  assert.equal(a.sessionId, b.sessionId);
  assert.equal(a.isNewSession, false);
  assert.notEqual(later.sessionId, a.sessionId);
  assert.notEqual(nextDay.visitorId, a.visitorId);
});
