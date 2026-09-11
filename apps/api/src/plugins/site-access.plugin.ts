import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { notFound } from "../errors/http-errors.js";
import { siteAccessDenied, sharePasswordRequired } from "../errors/domain-errors.js";
import { verifyShareToken } from "../core/website/share-token.js";
import type { WebsiteRole } from "../generated/prisma/client.js";

export type ResolvedSite = {
  id: string;
  name: string;
  domain: string;
  timezone: string;
  userId: string;
  isPublic: boolean;
  /** bcrypt hash guarding the public dashboard; null when the link is enough. */
  sharePasswordHash: string | null;
  /** Everyone besides the owner with access, and what they may do. */
  members: { userId: string; role: WebsiteRole }[];
};

/**
 * How the current request may use the site. `owner` and `admin` manage it,
 * `viewer` reads everything including realtime and exports, `public` reads
 * the shared dashboard only.
 */
export type SiteRole = "owner" | "admin" | "viewer" | "public";

const CACHE_PREFIX = "site:";
const CACHE_TTL = 60; // seconds

export const SHARE_TOKEN_HEADER = "x-share-token";

/**
 * Resolves :siteId into request.website and enforces access.
 *
 * Analytics endpoints previously had no authorization at all, so any site's
 * numbers were readable by anyone who knew or guessed a website UUID. Access is
 * now: the owner and members always, anyone if the site's dashboard is public
 * (with a valid share token when the share has a password), nobody else.
 *
 * The lookup is cached in Redis for a minute because it runs on every dashboard
 * request; the cache is invalidated whenever the site, its members or its
 * sharing settings change.
 */
const siteAccessPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest("website", null as any);
  fastify.decorateRequest("siteRole", null as any);

  const loadSite = async (
    request: FastifyRequest,
    siteId: string,
  ): Promise<ResolvedSite | null> => {
    const key = `${CACHE_PREFIX}${siteId}`;

    const cached = await request.ctx.redis.get(key).catch(() => null);
    if (cached) {
      try {
        const site = JSON.parse(cached) as Partial<ResolvedSite>;
        // Entries written before members and share passwords existed lack
        // the fields; treat them as a miss rather than as "no members".
        if (Array.isArray(site.members) && "sharePasswordHash" in site) {
          return site as ResolvedSite;
        }
      } catch {
        // fall through to the database
      }
    }

    const site = await request.ctx.prisma.website.findUnique({
      where: { id: siteId },
      select: {
        id: true,
        name: true,
        domain: true,
        timezone: true,
        userId: true,
        isPublic: true,
        sharePasswordHash: true,
        members: { select: { userId: true, role: true } },
      },
    });

    if (!site) return null;

    await request.ctx.redis
      .setex(key, CACHE_TTL, JSON.stringify(site))
      .catch(() => {});

    return site;
  };

  fastify.decorate(
    "authorizeSite",
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { siteId } = request.params as { siteId?: string };
      if (!siteId) throw notFound("Site not found");

      const site = await loadSite(request, siteId);
      if (!site) throw notFound("Site not found");

      const userId = request.session?.userId;
      let role: SiteRole | null = null;

      if (userId && userId === site.userId) {
        role = "owner";
      } else if (userId) {
        const member = site.members.find((m) => m.userId === userId);
        if (member) role = member.role === "ADMIN" ? "admin" : "viewer";
      }

      if (!role && site.isPublic) {
        if (site.sharePasswordHash) {
          const header = request.headers[SHARE_TOKEN_HEADER];
          const token = Array.isArray(header) ? header[0] : header;
          if (!verifyShareToken(site.id, site.sharePasswordHash, token)) {
            // The site exists and is shared: the dashboard should ask for the
            // password, so this is distinguishable from "no access".
            throw sharePasswordRequired();
          }
        }
        role = "public";
      }

      if (!role) {
        // Deliberately the same shape whether the site exists or not, so a
        // stranger cannot enumerate valid site ids.
        throw siteAccessDenied();
      }

      request.website = site;
      request.siteRole = role;
    },
  );

  fastify.decorate("invalidateSiteCache", async (siteId: string) => {
    await fastify.redis.del(`${CACHE_PREFIX}${siteId}`).catch(() => {});
  });
};

export default fp(siteAccessPlugin);
