import { FastifyInstance } from "fastify";

import {
  breakdownController,
  exportController,
  getConversionsController,
  getCustomEventPropertiesController,
  getCustomEventsController,
  getJourneysController,
  getMainGraphController,
  getPageDetailController,
  getPagesController,
  getRealtimeController,
  getRealtimeVisitorsController,
  getTopStatsController,
  getVisitorActivityController,
  realtimeStreamController,
} from "../../controllers/analytics.controller.js";
import { BREAKDOWN_SEGMENTS } from "../../core/analytics/export.service.js";

export default async function analyticsRoutes(fastify: FastifyInstance) {
  // Every analytics read resolves :siteId and enforces owner-or-public access.
  // optionalAuthenticate runs first so an owner is recognised when logged in.
  const guard = {
    preHandler: [fastify.optionalAuthenticate, fastify.authorizeSite],
  };

  // URL segment -> dimension lives in export.service.ts so the export offers
  // exactly the breakdowns the dashboard has. Adding one is one line there.
  for (const [segment, dimension] of Object.entries(BREAKDOWN_SEGMENTS)) {
    fastify.get(`/:siteId/${segment}`, guard, breakdownController(dimension));
  }

  // Pages: the per-page performance table and the single-page detail view.
  // The page is identified by its stored url_path, passed as ?path= on the
  // detail endpoint because paths contain slashes.
  fastify.get("/:siteId/pages", guard, getPagesController);
  fastify.get("/:siteId/pages/detail", guard, getPageDetailController);

  fastify.get("/:siteId/top-stats", guard, getTopStatsController);
  fastify.get("/:siteId/main-graph", guard, getMainGraphController);
  fastify.get("/:siteId/realtime", guard, getRealtimeController);

  // Realtime page: per-visitor data and the live stream. The guard resolves
  // the site; the controllers additionally require the owner (never public).
  const ownerGuard = {
    preHandler: [fastify.authenticate, fastify.authorizeSite],
  };
  fastify.get(
    "/:siteId/realtime/visitors",
    ownerGuard,
    getRealtimeVisitorsController,
  );
  fastify.get<{ Params: { siteId: string; visitorId: string } }>(
    "/:siteId/realtime/visitors/:visitorId/activity",
    ownerGuard,
    getVisitorActivityController,
  );
  fastify.get("/:siteId/realtime/stream", ownerGuard, realtimeStreamController);
  fastify.get("/:siteId/conversions", guard, getConversionsController);
  // Plan-gated: the site owner's plan must include journeys, also on public
  // dashboards (the viewer's plan is irrelevant). Enforced here, not in the UI.
  fastify.get(
    "/:siteId/journeys",
    { preHandler: [...guard.preHandler, fastify.requireEntitlement("journeys")] },
    getJourneysController,
  );
  fastify.get("/:siteId/custom-events", guard, getCustomEventsController);
  // Custom event properties: keys for an event, or values of one key.
  fastify.get(
    "/:siteId/custom-events/properties",
    guard,
    getCustomEventPropertiesController,
  );

  // CSV export: owner only (the controller checks), plan-gated. Works with a
  // session cookie from the dashboard or a bearer API key from a script.
  fastify.get(
    "/:siteId/export",
    { preHandler: [fastify.authenticate, fastify.authorizeSite, fastify.requireEntitlement("exports")] },
    exportController,
  );
}
