import { FastifyReply, FastifyRequest } from "fastify";

import { getFavicon, normalizeDomain } from "../core/website/favicon.service.js";

/**
 * A day in the browser's cache as well as ours, so revisiting the site list
 * costs no request at all. `immutable` is deliberately absent: an icon does
 * change, just rarely.
 */
const CACHE_CONTROL = "public, max-age=86400";

/**
 * The icon for a domain, or 404.
 *
 * A miss is a plain 404 rather than a generic globe, because the dashboard
 * already has a fallback that is better than a globe: the coloured initial
 * tile, which stays put when the <img> fails to load.
 */
export const getFaviconController = async (
  request: FastifyRequest<{ Params: { domain: string } }>,
  reply: FastifyReply,
) => {
  const domain = normalizeDomain(request.params.domain);
  if (!domain) return reply.code(400).send();

  const icon = await getFavicon(request.ctx.redis, domain);
  if (!icon) {
    // Negative answers are cached for an hour: the service already holds a
    // day-long miss, and a shorter browser cache means a newly published
    // icon appears without waiting out the long one.
    return reply.code(404).header("Cache-Control", "public, max-age=3600").send();
  }

  return reply
    .header("Content-Type", icon.contentType)
    .header("Cache-Control", CACHE_CONTROL)
    .send(icon.body);
};
