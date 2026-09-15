import { FastifyInstance } from "fastify";

import { getFaviconController } from "../../controllers/favicon.controller.js";

export default async function faviconRoutes(fastify: FastifyInstance) {
  /**
   * Public on purpose. The dashboard loads this as an <img src>, and on the
   * hosted split-host setup that is a cross-site request from app.webyz.io to
   * api.webyz.io; the session cookie is SameSite=Lax, so no cookie rides
   * along and an authenticated route could never answer. Nothing here is
   * private either: it returns a public website's public icon.
   */
  fastify.get<{ Params: { domain: string } }>("/favicon/:domain", getFaviconController);
}
