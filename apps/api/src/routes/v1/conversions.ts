import { FastifyInstance } from "fastify";

import {
  createFunnelController,
  deleteFunnelController,
  getFunnelAnalysisController,
  getGoalDetailController,
  listFunnelsController,
  updateFunnelController,
} from "../../controllers/conversions.controller.js";
import type { FunnelInput } from "../../core/analytics/funnels.service.js";

type SiteParams = { siteId: string };
type FunnelParams = SiteParams & { funnelId: string };

const funnelBodySchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    steps: {
      type: "array",
      minItems: 2,
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          label: { type: "string", maxLength: 120 },
          eventName: { type: "string", maxLength: 120 },
          pagePath: { type: "string", maxLength: 500 },
        },
        additionalProperties: false,
      },
    },
  },
  required: ["name", "steps"],
  additionalProperties: false,
};

/** Funnels CRUD + analysis, and goal detail. All owner-only. */
export default async function conversionsRoutes(fastify: FastifyInstance) {
  const owner = { preHandler: [fastify.authenticate] };
  // Funnels are a plan feature: the authenticated user's plan must include
  // them (ownership of the site is then checked by the controller).
  // authorizeSite runs first so the entitlement is the site owner's plan, not
  // the caller's: a member manages funnels on the owner's plan.
  const funnels = { preHandler: [fastify.authenticate, fastify.authorizeSite, fastify.requireEntitlement("funnels")] };

  fastify.get<{ Params: SiteParams }>(
    "/websites/:siteId/funnels",
    funnels,
    listFunnelsController,
  );

  fastify.post<{ Params: SiteParams; Body: FunnelInput }>(
    "/websites/:siteId/funnels",
    { ...funnels, schema: { body: funnelBodySchema } },
    createFunnelController,
  );

  fastify.patch<{ Params: FunnelParams; Body: FunnelInput }>(
    "/websites/:siteId/funnels/:funnelId",
    { ...funnels, schema: { body: funnelBodySchema } },
    updateFunnelController,
  );

  fastify.delete<{ Params: FunnelParams }>(
    "/websites/:siteId/funnels/:funnelId",
    funnels,
    deleteFunnelController,
  );

  fastify.get<{ Params: FunnelParams }>(
    "/websites/:siteId/funnels/:funnelId/analysis",
    funnels,
    getFunnelAnalysisController,
  );

  fastify.get<{ Params: SiteParams & { goalId: string } }>(
    "/websites/:siteId/goals/:goalId/detail",
    owner,
    getGoalDetailController,
  );
}
