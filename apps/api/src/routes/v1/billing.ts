import { FastifyInstance } from "fastify";

import {
  cancelController,
  cancelPendingChangeController,
  cancelPreviewController,
  changePlanController,
  changePreviewController,
  invoicesController,
  checkoutConfigController,
  checkoutController,
  mySubController,
  portalController,
  resumeController,
  spendCapController,
  invoicePdfController,
  paddleWebhookController,
  usageController,
} from "../../controllers/billing.controller.js";

const checkoutBodySchema = {
  type: "object",
  properties: {
    planId: { type: "string", minLength: 1 },
    billingCycle: { type: "string", enum: ["MONTHLY", "YEARLY"] },
  },
  required: ["planId"],
  additionalProperties: false,
};

export default async function billingRoutes(fastify: FastifyInstance) {
  fastify.post<{
    Body: { planId: string; billingCycle?: "MONTHLY" | "YEARLY" };
  }>(
    "/billing/checkout",
    {
      preHandler: [fastify.authenticate],
      schema: { body: checkoutBodySchema },
    },
    checkoutController,
  );

  fastify.get("/billing/checkout-config", { preHandler: [fastify.authenticate] }, checkoutConfigController);

  fastify.get(
    "/billing/portal",
    { preHandler: [fastify.authenticate] },
    portalController,
  );

  fastify.post(
    "/billing/cancel",
    { preHandler: [fastify.authenticate] },
    cancelController,
  );

  fastify.post(
    "/billing/resume",
    { preHandler: [fastify.authenticate] },
    resumeController,
  );

  fastify.post<{ Body: { planId: string; billingCycle: "MONTHLY" | "YEARLY" } }>(
    "/billing/change-plan",
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: "object",
          properties: {
            planId: { type: "string", minLength: 1 },
            billingCycle: { type: "string", enum: ["MONTHLY", "YEARLY"] },
          },
          required: ["planId", "billingCycle"],
          additionalProperties: false,
        },
      },
    },
    changePlanController,
  );

  fastify.get(
    "/billing/me",
    { preHandler: [fastify.authenticate] },
    mySubController,
  );

  fastify.get<{ Querystring: { planId: string; billingCycle: "MONTHLY" | "YEARLY" } }>(
    "/billing/change-preview",
    {
      preHandler: [fastify.authenticate],
      schema: {
        querystring: {
          type: "object",
          properties: {
            planId: { type: "string", minLength: 1 },
            billingCycle: { type: "string", enum: ["MONTHLY", "YEARLY"] },
          },
          required: ["planId", "billingCycle"],
        },
      },
    },
    changePreviewController,
  );

  fastify.post("/billing/change-plan/cancel", { preHandler: [fastify.authenticate] }, cancelPendingChangeController);

  fastify.get("/billing/cancel-preview", { preHandler: [fastify.authenticate] }, cancelPreviewController);

  fastify.get("/billing/invoices", { preHandler: [fastify.authenticate] }, invoicesController);

  fastify.get<{ Params: { invoiceId: string } }>(
    "/billing/invoices/:invoiceId/pdf",
    { preHandler: [fastify.authenticate] },
    invoicePdfController,
  );

  fastify.put<{ Body: { capCents: number } }>(
    "/billing/spend-cap",
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: "object",
          properties: { capCents: { type: "integer", minimum: 0, maximum: 100_000_000 } },
          required: ["capCents"],
          additionalProperties: false,
        },
      },
    },
    spendCapController,
  );

  fastify.get(
    "/billing/usage",
    { preHandler: [fastify.authenticate] },
    usageController,
  );

  // Encapsulated scope: content type parsers do not leak out of a Fastify
  // plugin, so only this route sees the raw-buffer JSON parser.
  fastify.register(async (scoped) => {
    scoped.removeAllContentTypeParsers();
    scoped.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_req, body, done) => done(null, body),
    );

    // The provider's IPs are shared across every one of its customers; never
    // rate limit them.
    scoped.post(
      "/paddle/webhook",
      { config: { rateLimit: false } },
      paddleWebhookController,
    );
  });
}
