import type { AppContext } from "../../../lib/context.js";
import { badRequest, notFound } from "../../../errors/http-errors.js";
import { getEntitlements, getLimit, invalidateEntitlements } from "../entitlements/entitlement.service.js";

type Deps = Pick<AppContext, "prisma" | "redis">;

/**
 * Keep a user's active site count within their plan's `sites` entitlement
 * without deleting anything.
 *
 * Sites the customer has already marked active are preferred; beyond that the
 * oldest stay active (decision 5: never by traffic). Excess sites become
 * inactive with the reason recorded, stop ingesting, and keep their history.
 * When the plan allows more again (upgrade, or the customer picks a different
 * set), inactive sites are reactivated up to the limit, oldest first.
 */
/**
 * Which sites stay active under a limit: currently active ones first (the
 * customer's choice), then inactive; each group oldest first. Pure, so the
 * change preview can show exactly what reconciliation would do.
 */
export const pickActiveSites = <S extends { id: string; isActive: boolean; createdAt: Date }>(sites: S[], limit: number) => {
  const byAge = [...sites].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const ranked = [...byAge.filter((s) => s.isActive), ...byAge.filter((s) => !s.isActive)];
  const keep = new Set(ranked.slice(0, Math.max(0, limit)).map((s) => s.id));
  return {
    keep,
    toRestrict: sites.filter((s) => s.isActive && !keep.has(s.id)),
    toActivate: sites.filter((s) => !s.isActive && keep.has(s.id)),
  };
};

export const reconcileSitesToLimit = async (ctx: Deps, userId: string, reason: string) => {
  const { prisma } = ctx;
  const { entitlements } = await getEntitlements(ctx, userId);
  const limit = getLimit(entitlements, "sites");

  const sites = await prisma.website.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, domain: true, isActive: true, createdAt: true },
  });

  const { keep } = pickActiveSites(sites, limit);

  const toRestrict = sites.filter((s) => s.isActive && !keep.has(s.id));
  const toActivate = sites.filter((s) => !s.isActive && keep.has(s.id));

  if (toRestrict.length) {
    await prisma.website.updateMany({
      where: { id: { in: toRestrict.map((s) => s.id) } },
      data: { isActive: false, restrictionReason: reason },
    });
  }
  if (toActivate.length) {
    await prisma.website.updateMany({
      where: { id: { in: toActivate.map((s) => s.id) } },
      data: { isActive: true, restrictionReason: null },
    });
  }
  if (toRestrict.length || toActivate.length) {
    for (const s of [...toRestrict, ...toActivate]) await ctx.redis.del(`site:${s.id}`).catch(() => {});
  }

  return { limit, restricted: toRestrict, activated: toActivate, active: keep.size };
};

/**
 * Customer picks which sites stay active. Exactly `limit` ids at most; the
 * rest become inactive. Never deletes.
 */
export const chooseActiveSites = async (ctx: Deps, userId: string, activeIds: string[]) => {
  const { prisma } = ctx;
  const { entitlements } = await getEntitlements(ctx, userId);
  const limit = getLimit(entitlements, "sites");
  if (activeIds.length > limit) {
    throw badRequest(`Your plan allows ${limit} active website${limit === 1 ? "" : "s"}; you chose ${activeIds.length}.`);
  }
  const owned = await prisma.website.findMany({ where: { userId }, select: { id: true } });
  const ownedIds = new Set(owned.map((w) => w.id));
  for (const id of activeIds) if (!ownedIds.has(id)) throw notFound("Site not found");

  await prisma.$transaction([
    prisma.website.updateMany({
      where: { userId, id: { notIn: activeIds } },
      data: { isActive: false, restrictionReason: "CUSTOMER_CHOICE" },
    }),
    prisma.website.updateMany({
      where: { userId, id: { in: activeIds } },
      data: { isActive: true, restrictionReason: null },
    }),
  ]);
  for (const w of owned) await ctx.redis.del(`site:${w.id}`).catch(() => {});
  await invalidateEntitlements(ctx, userId);
  return { limit, active: activeIds.length };
};
