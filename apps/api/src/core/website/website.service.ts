import crypto from "node:crypto";

import { AppContext } from "../../lib/context.js";
import { badRequest, conflict, notFound } from "../../errors/http-errors.js";
import { hasAnyEventQuery } from "../../db/clickhouse/event.js";
import { purgeWebsiteAnalytics } from "../../db/clickhouse/website.js";
import { reconcileRestriction } from "../billing/state/restriction.service.js";
import {
  getEntitlements,
  getLimit,
} from "../billing/entitlements/entitlement.service.js";

export interface CreateWebsiteInput {
  name: string;
  domain: string;
  timezone?: string;
}

export interface UpdateWebsiteInput {
  name?: string;
  domain?: string;
  timezone?: string;
}

/** Strip scheme, www, path and port so "https://www.a.com/x" becomes "a.com". */
export const normalizeDomain = (raw: string): string => {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.split("/")[0];
  value = value.split(":")[0];
  return value;
};

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Validate against the IANA timezone database the runtime already ships. */
const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const createWebsite = async (
  ctx: AppContext,
  userId: string,
  input: CreateWebsiteInput,
) => {
  const domain = normalizeDomain(input.domain);

  if (!DOMAIN_PATTERN.test(domain)) {
    throw badRequest(`"${input.domain}" is not a valid domain`);
  }

  const timezone = input.timezone?.trim() || "UTC";
  if (!isValidTimezone(timezone)) {
    throw badRequest(`"${timezone}" is not a valid IANA timezone`);
  }

  // Enforce the plan's website allowance. Without this a free account could
  // add unlimited sites and bypass the per-site event quota entirely.
  const { planName, entitlements } = await getEntitlements(ctx, userId);
  const siteLimit = getLimit(entitlements, "sites");
  const existingCount = await ctx.prisma.website.count({ where: { userId } });

  if (existingCount >= siteLimit) {
    throw badRequest(
      `Your ${planName} plan allows ${siteLimit} website${siteLimit === 1 ? "" : "s"}. Upgrade to add more.`,
    );
  }

  const duplicate = await ctx.prisma.website.findUnique({ where: { domain } });
  if (duplicate) {
    throw conflict(`${domain} is already being tracked`);
  }

  const website = await ctx.prisma.website.create({
    data: { name: input.name.trim(), domain, timezone, userId },
  });
  // A new site inherits the account's restriction: an account paused for
  // non-payment or at its cap cannot resume tracking by adding a site.
  const restriction = await reconcileRestriction(ctx, userId);
  return restriction.decision.blocked ? { ...website, isBlocked: true } : website;
};

/** The caller's relationship to a site, from the caller's point of view. */
export type WebsiteAccessRole = "owner" | "admin" | "viewer";

/**
 * Sites the caller owns plus sites shared with them, each stamped with the
 * caller's role so the dashboard can hide what the role cannot do. Owned
 * sites first, then shared, newest first within each.
 */
export const listWebsites = async ({ prisma }: AppContext, userId: string) => {
  const [owned, memberships] = await Promise.all([
    prisma.website.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.websiteMember.findMany({
      where: { userId },
      include: { website: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return [
    ...owned.map((site) => ({ ...site, role: "owner" as WebsiteAccessRole })),
    ...memberships.map((m) => ({
      ...m.website,
      role: (m.role === "ADMIN" ? "admin" : "viewer") as WebsiteAccessRole,
    })),
  ];
};

/**
 * Whether the site has ever received an event. Drives the post-create setup
 * screen, which polls this until the tracking snippet sends its first hit.
 */
export const getInstallStatus = async (
  ctx: AppContext,
  userId: string,
  siteId: string,
) => {
  await getAccessibleWebsite(ctx, userId, siteId);
  const hasEvents = await hasAnyEventQuery(ctx.clickhouse, siteId);
  return { hasEvents };
};

/**
 * Load a site the caller owns, or fail. For what only the owner may do:
 * delete the site, hand it over, and anything that touches the owner's bill.
 */
export const getOwnedWebsite = async (
  { prisma }: AppContext,
  userId: string,
  siteId: string,
) => {
  const website = await prisma.website.findFirst({
    where: { id: siteId, userId },
  });

  if (!website) throw notFound("Site not found");
  return website;
};

/**
 * Load a site the caller owns or administers, or fail. Used by every
 * settings-style mutation (goals, funnels, sharing, integrations, members):
 * an ADMIN member manages the site the way the owner does.
 */
export const getManagedWebsite = async (
  { prisma }: AppContext,
  userId: string,
  siteId: string,
) => {
  const website = await prisma.website.findFirst({
    where: {
      id: siteId,
      OR: [{ userId }, { members: { some: { userId, role: "ADMIN" } } }],
    },
  });

  if (!website) throw notFound("Site not found");
  return website;
};

/** Load a site the caller owns or is a member of (any role), or fail. */
export const getAccessibleWebsite = async (
  { prisma }: AppContext,
  userId: string,
  siteId: string,
) => {
  const website = await prisma.website.findFirst({
    where: {
      id: siteId,
      OR: [{ userId }, { members: { some: { userId } } }],
    },
    include: { members: { where: { userId }, select: { role: true } } },
  });

  if (!website) throw notFound("Site not found");
  const { members, ...site } = website;
  const role: WebsiteAccessRole =
    site.userId === userId ? "owner" : members[0]?.role === "ADMIN" ? "admin" : "viewer";
  return { ...site, role };
};

export const updateWebsite = async (
  ctx: AppContext,
  userId: string,
  siteId: string,
  input: UpdateWebsiteInput,
) => {
  await getManagedWebsite(ctx, userId, siteId);

  const data: UpdateWebsiteInput = {};

  if (input.name !== undefined) data.name = input.name.trim();

  if (input.timezone !== undefined) {
    const timezone = input.timezone.trim();
    if (!isValidTimezone(timezone)) {
      throw badRequest(`"${timezone}" is not a valid IANA timezone`);
    }
    data.timezone = timezone;
  }

  if (input.domain !== undefined) {
    const domain = normalizeDomain(input.domain);
    if (!DOMAIN_PATTERN.test(domain)) {
      throw badRequest(`"${input.domain}" is not a valid domain`);
    }

    const clash = await ctx.prisma.website.findUnique({ where: { domain } });
    if (clash && clash.id !== siteId) {
      throw conflict(`${domain} is already being tracked`);
    }
    data.domain = domain;
  }

  return ctx.prisma.website.update({ where: { id: siteId }, data });
};

/**
 * Delete a site and its analytics data.
 *
 * ClickHouse deletes are asynchronous mutations, so the rows disappear shortly
 * after this returns rather than immediately. Postgres is the source of truth
 * for whether the site exists, so the dashboard stops serving it right away.
 */
export const deleteWebsite = async (
  ctx: AppContext,
  userId: string,
  siteId: string,
) => {
  await getOwnedWebsite(ctx, userId, siteId);

  await ctx.prisma.website.delete({ where: { id: siteId } });

  await purgeWebsiteAnalytics(ctx.clickhouse, siteId).catch((err) => {
    console.error(`[delete-website] analytics cleanup failed for ${siteId}`, err);
  });
};

/** Turn on public sharing and mint a fresh unguessable slug. */
export const enableSharing = async (
  ctx: AppContext,
  userId: string,
  siteId: string,
) => {
  await getManagedWebsite(ctx, userId, siteId);

  const publicSlug = crypto.randomBytes(16).toString("base64url");

  return ctx.prisma.website.update({
    where: { id: siteId },
    data: { isPublic: true, publicSlug },
  });
};

/**
 * Turn off sharing and drop the slug, so any link already handed out stops
 * working even if sharing is re-enabled later. The share password goes with
 * it: a password belongs to a link, and the next link starts clean.
 */
export const disableSharing = async (
  ctx: AppContext,
  userId: string,
  siteId: string,
) => {
  await getManagedWebsite(ctx, userId, siteId);

  return ctx.prisma.website.update({
    where: { id: siteId },
    data: { isPublic: false, publicSlug: null, sharePasswordHash: null },
  });
};

/**
 * Resolve a shared link to the site it points at. Reports whether a password
 * stands in front of it (never the hash) so the public page can ask first
 * instead of firing every analytics query into a 401.
 */
export const getWebsiteBySlug = async (
  { prisma }: AppContext,
  slug: string,
) => {
  const website = await prisma.website.findFirst({
    where: { publicSlug: slug, isPublic: true },
    select: { id: true, name: true, domain: true, timezone: true, sharePasswordHash: true },
  });

  if (!website) throw notFound("Shared dashboard not found");
  const { sharePasswordHash, ...site } = website;
  return { ...site, hasPassword: sharePasswordHash !== null };
};
