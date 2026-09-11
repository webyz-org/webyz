import { test } from "node:test";
import assert from "node:assert/strict";
import type { Redis } from "ioredis";

import { validateSession } from "./sessions.service.js";
import type { AppContext } from "../../lib/context.js";

/** Every command rejects, as the real client does when Redis is unreachable. */
const brokenRedis = () => {
  const fail = async () => {
    throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
  };
  return { get: fail, setex: fail, del: fail } as unknown as Redis;
};

const sessionRow = (expiresAt: Date) => ({
  id: "sess-1",
  userId: "user-1",
  expiresAt,
  user: { id: "user-1", email: "a@example.com", name: "A" },
});

const prismaWith = (row: ReturnType<typeof sessionRow> | null) => {
  const calls: string[] = [];
  const prisma = {
    session: {
      findUnique: async () => {
        calls.push("findUnique");
        return row;
      },
      update: async () => {
        calls.push("update");
        return row;
      },
      delete: async () => {
        calls.push("delete");
        return row;
      },
    },
  };
  return { prisma, calls };
};

test("with Redis down a valid session is still resolved from Postgres", async () => {
  const far = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  const { prisma, calls } = prismaWith(sessionRow(far));
  const ctx = { prisma, redis: brokenRedis() } as unknown as AppContext;

  const session = await validateSession(ctx, "sess-1");

  assert.deepEqual(session, {
    userId: "user-1",
    email: "a@example.com",
    name: "A",
    sessionId: "sess-1",
  });
  assert.deepEqual(calls, ["findUnique"]);
});

test("with Redis down an unknown session is rejected, not errored", async () => {
  const { prisma } = prismaWith(null);
  const ctx = { prisma, redis: brokenRedis() } as unknown as AppContext;

  assert.equal(await validateSession(ctx, "nope"), null);
});

test("with Redis down an expired session is rejected and cleaned up", async () => {
  const past = new Date(Date.now() - 1000);
  const { prisma, calls } = prismaWith(sessionRow(past));
  const ctx = { prisma, redis: brokenRedis() } as unknown as AppContext;

  assert.equal(await validateSession(ctx, "sess-1"), null);
  assert.deepEqual(calls, ["findUnique", "delete"]);
});
