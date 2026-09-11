import { FastifyInstance } from "fastify";

import {
  disconnectGscController,
  getGscAuthUrlController,
  getGscSearchAnalyticsController,
  getGscStatusController,
  gscCallbackController,
  listGscPropertiesController,
  selectGscPropertyController,
} from "../../controllers/gsc.controller.js";

/**
 * Google Search Console. Connection management lives under the site because a
 * connection belongs to one website; the OAuth callback is a single global
 * endpoint that Google redirects browsers to (register it in the Google Cloud
 * OAuth client alongside the login redirect).
 */
type SiteParams = { siteId: string };

export default async function gscRoutes(fastify: FastifyInstance) {
  // Search Console is a plan feature; every site-scoped route checks the
  // authenticated user's plan before the controller checks site ownership.
  // The Google callback has no session and is gated inside the service.
  // authorizeSite runs first so the entitlement is the site owner's plan, not
  // the caller's: a member uses Search Console on the owner's plan.
  const owner = { preHandler: [fastify.authenticate, fastify.authorizeSite, fastify.requireEntitlement("search_console")] };

  fastify.get<{ Params: SiteParams }>(
    "/websites/:siteId/gsc",
    owner,
    getGscStatusController,
  );
  fastify.get<{ Params: SiteParams }>(
    "/websites/:siteId/gsc/auth-url",
    owner,
    getGscAuthUrlController,
  );
  fastify.get<{ Params: SiteParams }>(
    "/websites/:siteId/gsc/properties",
    owner,
    listGscPropertiesController,
  );
  fastify.post<{ Params: SiteParams; Body: { propertyUri?: string } }>(
    "/websites/:siteId/gsc/property",
    {
      ...owner,
      schema: {
        body: {
          type: "object",
          properties: { propertyUri: { type: "string", maxLength: 500 } },
          required: ["propertyUri"],
          additionalProperties: false,
        },
      },
    },
    selectGscPropertyController,
  );
  fastify.delete<{ Params: SiteParams }>(
    "/websites/:siteId/gsc",
    owner,
    disconnectGscController,
  );

  // Search terms / pages / countries / devices with clicks, impressions,
  // CTR and position. Owner-only: never exposed on public dashboards.
  fastify.get<{ Params: SiteParams }>(
    "/websites/:siteId/gsc/search-analytics",
    owner,
    getGscSearchAnalyticsController,
  );

  // Google redirects here after consent; no session required.
  fastify.get("/gsc/callback", gscCallbackController);
}
