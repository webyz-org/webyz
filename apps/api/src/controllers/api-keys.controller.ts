import type { FastifyReply, FastifyRequest } from "fastify";

import { sendResponse } from "../http/helper/send-response.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../core/auth/api-keys.service.js";

export const listApiKeysController = async (request: FastifyRequest, reply: FastifyReply) => {
  const keys = await listApiKeys(request.ctx, request.session.userId);
  return sendResponse(reply, keys);
};

/** The plaintext token appears in this response and nowhere else, ever. */
export const createApiKeyController = async (
  request: FastifyRequest<{ Body: { name: string } }>,
  reply: FastifyReply,
) => {
  const result = await createApiKey(request.ctx, request.session.userId, request.body.name);
  return sendResponse(reply, result, { statusCode: 201 });
};

export const revokeApiKeyController = async (
  request: FastifyRequest<{ Params: { keyId: string } }>,
  reply: FastifyReply,
) => {
  const key = await revokeApiKey(request.ctx, request.session.userId, request.params.keyId);
  return sendResponse(reply, key);
};
