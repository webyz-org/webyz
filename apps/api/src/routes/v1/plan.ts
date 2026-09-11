import { FastifyInstance } from "fastify";

import {
  getCurrentUserPlanController,
  getPlansController,
} from "../../controllers/plan.controller.js";

export default async function planRoutes(fastify: FastifyInstance) {
  // Public: the pricing page reads this.
  fastify.get("/plans", getPlansController);

  fastify.get(
    "/plans/me",
    { preHandler: [fastify.authenticate] },
    getCurrentUserPlanController,
  );
}
