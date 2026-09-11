import { FastifyReply, FastifyRequest } from "fastify";

import { sendResponse } from "../http/helper/send-response.js";
import { normalizePagination } from "../http/normalize/pagination.js";
import { resolveRetainedWindow } from "../core/billing/entitlements/retention.js";
import { getAccessibleWebsite, getManagedWebsite } from "../core/website/website.service.js";
import {
  GscSortKey,
  completeGscConnection,
  createGscAuthUrl,
  disconnectGsc,
  getGscStatus,
  getSearchAnalytics,
  listProperties,
  selectProperty,
} from "../core/gsc/gsc.service.js";
import { badRequest } from "../errors/http-errors.js";
import { FRONTEND_URL } from "../config/env.js";
import type { GscDimension } from "../core/gsc/gsc-client.js";

/**
 * Google Search Console endpoints. Everything except the OAuth callback is
 * site people only (owner or member; changes need owner or admin) - search queries and rankings are more
 * sensitive than any aggregate, so they are never exposed on public sites.
 */

type SiteParams = { siteId: string };

export const getGscStatusController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const website = await getAccessibleWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );
  const status = await getGscStatus(request.ctx, website.id);
  return sendResponse(reply, status);
};

export const getGscAuthUrlController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const website = await getManagedWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );

  const url = await createGscAuthUrl(request.ctx, {
    siteId: website.id,
    userId: request.session.userId,
    domain: website.domain,
  });

  return sendResponse(reply, { url });
};

/**
 * OAuth callback. Unauthenticated by nature (Google redirects the browser
 * here); the Redis-backed single-use state is what ties it to a site and an
 * initiating owner. Always lands back on the site's settings page.
 */
export const gscCallbackController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const { state, code, error } = request.query as {
    state?: string;
    code?: string;
    error?: string;
  };

  if (error || !state || !code) {
    return reply.redirect(`${FRONTEND_URL}/sites?gsc=error`);
  }

  try {
    const { domain } = await completeGscConnection(request.ctx, state, code);
    return reply.redirect(
      `${FRONTEND_URL}/sites/${domain}/settings?section=integrations&gsc=connected`,
    );
  } catch (err) {
    request.log.error({ err }, "GSC connection failed");
    return reply.redirect(`${FRONTEND_URL}/sites?gsc=error`);
  }
};

export const listGscPropertiesController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const website = await getManagedWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );
  const properties = await listProperties(request.ctx, website.id);
  return sendResponse(reply, properties);
};

export const selectGscPropertyController = async (
  request: FastifyRequest<{ Params: SiteParams; Body: { propertyUri?: string } }>,
  reply: FastifyReply,
) => {
  const website = await getManagedWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );

  const propertyUri = request.body?.propertyUri;
  if (!propertyUri) throw badRequest("propertyUri is required");

  await selectProperty(request.ctx, website.id, propertyUri);
  const status = await getGscStatus(request.ctx, website.id);
  return sendResponse(reply, status);
};

export const disconnectGscController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const website = await getManagedWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );
  await disconnectGsc(request.ctx, website.id);
  return sendResponse(reply, { disconnected: true });
};

const GSC_DIMENSIONS: readonly GscDimension[] = [
  "query",
  "page",
  "country",
  "device",
];
const GSC_SORTS: readonly GscSortKey[] = [
  "clicks",
  "impressions",
  "ctr",
  "position",
];

export const getGscSearchAnalyticsController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const website = await getAccessibleWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );

  const query = request.query as {
    period?: string;
    date?: string;
    from?: string;
    to?: string;
    dimension?: string;
    search?: string;
    sort?: string;
    order?: string;
    limit?: string;
    page?: string;
  };

  // Google keeps 16 months; the plan's retention bounds it further.
  const range = await resolveRetainedWindow(request.ctx, {
    ownerId: website.userId,
    timezone: website.timezone,
    query,
    defaultPeriod: "last_28_days",
  });
  const { limit, page } = normalizePagination(query);

  const dimension = (GSC_DIMENSIONS as readonly string[]).includes(
    query.dimension ?? "",
  )
    ? (query.dimension as GscDimension)
    : "query";
  const sort = (GSC_SORTS as readonly string[]).includes(query.sort ?? "")
    ? (query.sort as GscSortKey)
    : "clicks";
  const order = query.order === "asc" ? "asc" : "desc";

  const data = await getSearchAnalytics(request.ctx, {
    websiteId: website.id,
    timezone: website.timezone,
    from: range.from,
    to: range.to,
    dimension,
    search: query.search?.slice(0, 200),
    sort,
    order,
    limit,
    page,
  });

  const { meta, ...rest } = data;
  return sendResponse(reply, rest, { meta });
};
