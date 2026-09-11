import type { FastifyInstance } from "fastify";

import {
  createApiKeyController,
  listApiKeysController,
  revokeApiKeyController,
} from "../../controllers/api-keys.controller.js";

const createBodySchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
  },
  required: ["name"],
  additionalProperties: false,
};

/**
 * Personal API keys. Session only: `authenticate` accepts bearer keys too, but
 * keys are read-only, so create and revoke are refused for them before the
 * handler runs, and the list is harmless (prefixes, never tokens).
 *
 * Creating a key is plan-gated (api_access). Listing and revoking are not, so
 * an account that downgrades can still see and clean up its keys.
 */
export default async function apiKeyRoutes(fastify: FastifyInstance) {
  const owner = { preHandler: [fastify.authenticate] };

  fastify.get("/api-keys", owner, listApiKeysController);

  fastify.post<{ Body: { name: string } }>(
    "/api-keys",
    {
      preHandler: [fastify.authenticate, fastify.requireEntitlement("api_access")],
      schema: { body: createBodySchema },
    },
    createApiKeyController,
  );

  fastify.delete<{ Params: { keyId: string } }>("/api-keys/:keyId", owner, revokeApiKeyController);
}
