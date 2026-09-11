import { FastifyInstance } from "fastify";

import {
  clearSharePasswordController,
  createGoalController,
  createWebsiteController,
  deleteGoalController,
  deleteWebsiteController,
  disableSharingController,
  enableSharingController,
  getInstallStatusController,
  getSharedWebsiteController,
  getWebsiteController,
  listGoalsController,
  listWebsitesController,
  setActiveWebsitesController,
  setSharePasswordController,
  unlockSharedWebsiteController,
  updateWebsiteController,
} from "../../controllers/websites.controller.js";
import {
  createWebsiteBodySchema,
  sharePasswordBodySchema,
  updateWebsiteBodySchema,
} from "../../schemas/website.schema.js";
import type {
  CreateWebsiteInput,
  UpdateWebsiteInput,
} from "../../core/website/website.service.js";

type SiteParams = { siteId: string };

const createGoalBodySchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    eventName: { type: "string", maxLength: 120 },
    pagePath: { type: "string", maxLength: 500 },
  },
  required: ["name"],
  additionalProperties: false,
};

export default async function websiteRoutes(fastify: FastifyInstance) {
  const owner = { preHandler: [fastify.authenticate] };

  fastify.post<{ Body: CreateWebsiteInput }>(
    "/websites",
    { ...owner, schema: { body: createWebsiteBodySchema } },
    createWebsiteController,
  );

  fastify.get("/websites", owner, listWebsitesController);

  // Which sites stay active when the plan allows fewer than the account has.
  fastify.post<{ Body: { activeIds: string[] } }>(
    "/websites/active",
    {
      ...owner,
      schema: {
        body: {
          type: "object",
          properties: { activeIds: { type: "array", items: { type: "string" }, maxItems: 100 } },
          required: ["activeIds"],
          additionalProperties: false,
        },
      },
    },
    setActiveWebsitesController,
  );

  fastify.get<{ Params: SiteParams }>(
    "/websites/:siteId",
    owner,
    getWebsiteController,
  );

  // Polled by the post-create setup screen until the first event lands.
  fastify.get<{ Params: SiteParams }>(
    "/websites/:siteId/install-status",
    owner,
    getInstallStatusController,
  );

  fastify.patch<{ Params: SiteParams; Body: UpdateWebsiteInput }>(
    "/websites/:siteId",
    { ...owner, schema: { body: updateWebsiteBodySchema } },
    updateWebsiteController,
  );

  fastify.delete<{ Params: SiteParams }>(
    "/websites/:siteId",
    owner,
    deleteWebsiteController,
  );

  // ─── Public dashboard sharing ───────────────────────────────────────────────

  fastify.post<{ Params: SiteParams }>(
    "/websites/:siteId/share",
    owner,
    enableSharingController,
  );

  fastify.delete<{ Params: SiteParams }>(
    "/websites/:siteId/share",
    owner,
    disableSharingController,
  );

  // A password in front of the share link. Set or replace, and remove.
  fastify.put<{ Params: SiteParams; Body: { password: string } }>(
    "/websites/:siteId/share/password",
    { ...owner, schema: { body: sharePasswordBodySchema } },
    setSharePasswordController,
  );

  fastify.delete<{ Params: SiteParams }>(
    "/websites/:siteId/share/password",
    owner,
    clearSharePasswordController,
  );

  // Public: no auth. Resolves a share link into a site id.
  fastify.get<{ Params: { slug: string } }>(
    "/shared/:slug",
    getSharedWebsiteController,
  );

  // Public: no auth. The app-wide rate limiter is what slows a guesser down.
  fastify.post<{ Params: { slug: string }; Body: { password: string } }>(
    "/shared/:slug/unlock",
    { schema: { body: sharePasswordBodySchema } },
    unlockSharedWebsiteController,
  );

  // ─── Goals ──────────────────────────────────────────────────────────────────

  fastify.get<{ Params: SiteParams }>(
    "/websites/:siteId/goals",
    owner,
    listGoalsController,
  );

  fastify.post<{
    Params: SiteParams;
    Body: { name: string; eventName?: string; pagePath?: string };
  }>(
    "/websites/:siteId/goals",
    { ...owner, schema: { body: createGoalBodySchema } },
    createGoalController,
  );

  fastify.delete<{ Params: SiteParams & { goalId: string } }>(
    "/websites/:siteId/goals/:goalId",
    owner,
    deleteGoalController,
  );
}
