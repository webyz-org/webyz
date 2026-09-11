import { test } from "node:test";
import assert from "node:assert/strict";

import { withSessionLock, type LockRedis } from "./session-lock.js";

/** An in-memory stand-in for the two Redis commands the lock uses. */
const fakeRedis = () => {
  const keys = new Map<string, string>();
  const redis = {
    set: async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes("NX") && keys.has(key)) return null;
      keys.set(key, value);
      return "OK";
    },
    del: async (key: string) => (keys.delete(key) ? 1 : 0),
  } as unknown as LockRedis;
  return { redis, keys };
};

const gauge = () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const work = async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 30));
    inFlight--;
  };
  return { work, max: () => maxInFlight };
};

test("concurrent writers to one session run one after another", async () => {
  const { redis, keys } = fakeRedis();
  const g = gauge();
  await Promise.all([
    withSessionLock(redis, "w", "s", g.work),
    withSessionLock(redis, "w", "s", g.work),
    withSessionLock(redis, "w", "s", g.work),
  ]);
  assert.equal(g.max(), 1);
  assert.equal(keys.size, 0, "lock released");
});

test("different sessions do not wait for each other", async () => {
  const { redis } = fakeRedis();
  const g = gauge();
  await Promise.all([withSessionLock(redis, "w", "a", g.work), withSessionLock(redis, "w", "b", g.work)]);
  assert.equal(g.max(), 2);
});

test("a Redis failure or no Redis runs the write unlocked rather than dropping it", async () => {
  const broken = {
    set: async () => {
      throw new Error("ECONNREFUSED");
    },
    del: async () => 0,
  } as unknown as LockRedis;
  assert.equal(await withSessionLock(broken, "w", "s", async () => "ran"), "ran");
  assert.equal(await withSessionLock(undefined, "w", "s", async () => "ran"), "ran");
});

test("the result and errors pass through, and the lock is released either way", async () => {
  const { redis, keys } = fakeRedis();
  assert.equal(await withSessionLock(redis, "w", "s", async () => 42), 42);
  await assert.rejects(
    withSessionLock(redis, "w", "s", async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(keys.size, 0);
});
