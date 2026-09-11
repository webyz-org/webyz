import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { SESSION_COOKIE_NAME } from "../config/constants.js";
import { validateSession } from "../core/auth/sessions.service.js";
import { bearerApiKey, validateApiKey } from "../core/auth/api-keys.service.js";
import { unauthorized } from "../errors/http-errors.js";
import { apiKeyReadOnly } from "../errors/domain-errors.js";

/**
 * Authentication: a session cookie from the dashboard, or a bearer API key
 * from a script.
 *
 * Both end in the same `request.session` shape so controllers do not care
 * which one it was. `request.auth.kind` records it for the one rule that
 * does care: API keys are read-only. GET and HEAD go through; anything else
 * is refused before the handler runs, so a leaked key can read a site's
 * numbers but cannot delete the site, change billing or mint more keys.
 *
 * Errors are thrown rather than sent directly so they go through the shared
 * error handler and come back in the same { success, error } envelope as
 * everything else.
 */
const READ_METHODS = new Set(["GET", "HEAD"]);

/**
 * Resolve whichever credential is present. Returns false when none was sent;
 * throws when one was sent but is invalid, so `optionalAuthenticate` treats a
 * bad key the same as `authenticate` does instead of silently downgrading a
 * scripted request to anonymous.
 */
const resolveCredentials = async (request: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
  const token = bearerApiKey(request.headers.authorization);
  if (token) {
    const principal = await validateApiKey(request.ctx, token);
    if (!principal) throw unauthorized("Invalid or revoked API key");
    if (!READ_METHODS.has(request.method)) throw apiKeyReadOnly();

    request.session = {
      userId: principal.userId,
      email: principal.email,
      name: principal.name,
      sessionId: `api_key:${principal.apiKeyId}`,
    };
    request.auth = { kind: "api_key", apiKeyId: principal.apiKeyId };
    return true;
  }

  const sessionId = request.cookies[SESSION_COOKIE_NAME];
  if (!sessionId) return false;

  const session = await validateSession(request.ctx, sessionId);
  if (!session) {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    throw unauthorized("Session expired. Please log in again.");
  }

  request.session = session;
  request.auth = { kind: "session" };
  return true;
};

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    const found = await resolveCredentials(request, reply);
    if (!found) throw unauthorized("Authentication required");
  });

  fastify.decorate("optionalAuthenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    // A missing or expired cookie is a normal anonymous visit here (public
    // dashboards); only a credential that was sent and rejected is an error.
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    const token = bearerApiKey(request.headers.authorization);
    if (!token && !sessionId) return;

    if (token) {
      await resolveCredentials(request, reply);
      return;
    }

    const session = await validateSession(request.ctx, sessionId!);
    if (session) {
      request.session = session;
      request.auth = { kind: "session" };
    }
  });
};

export default fp(authPlugin);
