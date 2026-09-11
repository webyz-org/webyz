import type { AppContext } from "../../../lib/context.js";
import {
  parseEntitlements,
  type Entitlements,
  type FeatureKey,
  type LimitKey,
} from "../catalog/entitlements.schema.js";
import { getLimit, hasFeature } from "../catalog/entitlements.schema.js";

export { getLimit, hasFeature };
export type { Entitlements, FeatureKey, LimitKey };

const CACHE_PREFIX = "ent:";
const CACHE_TTL = 60; // seconds

/**
 * Subscription statuses that grant the plan's entitlements. UNPAID keeps them
 * because the customer may have prepaid (annual base) and only a usage
 * invoice failed; ingest is restricted by the access state instead.
 */
export const LIVE_STATUSES = ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"] as const;

export type ResolvedEntitlements = {
  planId: string;
  planCode: string;
  planName: string;
  subscriptionId: string | null;
  entitlements: Entitlements;
};

/**
 * What a user is allowed right now: user -> live subscription -> plan ->
 * entitlements JSON. A user without a live subscription gets the free plan, so
 * every check has an answer even on a half-migrated database.
 *
 * Cached for a minute per user. Call `invalidateEntitlements` after any
 * subscription change so upgrades apply immediately.
 */
export const getEntitlements = async (
  ctx: Pick<AppContext, "prisma" | "redis">,
  userId: string,
): Promise<ResolvedEntitlements> => {
  const key = `${CACHE_PREFIX}${userId}`;

  const cached = await ctx.redis.get(key).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached) as ResolvedEntitlements;
    } catch {
      // fall through to the database
    }
  }

  const resolved = await resolveEntitlements(ctx, userId);

  await ctx.redis.setex(key, CACHE_TTL, JSON.stringify(resolved)).catch(() => {});
  return resolved;
};

export const invalidateEntitlements = async (
  ctx: Pick<AppContext, "redis">,
  userId: string,
) => {
  await ctx.redis.del(`${CACHE_PREFIX}${userId}`).catch(() => {});
};

const resolveEntitlements = async (
  { prisma }: Pick<AppContext, "prisma">,
  userId: string,
): Promise<ResolvedEntitlements> => {
  const subscription = await prisma.subscription.findFirst({
    where: { userId, status: { in: [...LIVE_STATUSES] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      plan: { select: { id: true, code: true, name: true, entitlements: true } },
    },
  });

  const plan =
    subscription?.plan ??
    (await prisma.plan.findFirst({
      where: { isFree: true },
      select: { id: true, code: true, name: true, entitlements: true },
    }));

  if (!plan) {
    throw new Error("No free plan configured; run prisma:seed");
  }

  return {
    planId: plan.id,
    planCode: plan.code,
    planName: plan.name,
    subscriptionId: subscription?.id ?? null,
    entitlements: parseEntitlements(plan.entitlements),
  };
};
