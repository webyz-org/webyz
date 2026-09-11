import type { FastifyInstance } from "fastify";

import type { ChangePasswordInput } from "../../core/auth/types.js";
import {
  changePassBodySchema,
  forgotPasswordBodySchema,
  loginUserBodySchema,
  logoutQuerySchema,
  resetPasswordBodySchema,
  signupUserBodySchema,
} from "../../schemas/user-auth.schema.js";
import {
  authProvidersController,
  changePasswordController,
  deleteAccountController,
  exportAccountController,
  forgotPasswordController,
  googleAuthController,
  googleCallbackController,
  listSessionsController,
  loginController,
  logoutController,
  meController,
  resetPasswordController,
  resendVerificationController,
  revokeOtherSessionsController,
  verifyEmailController,
  revokeSessionController,
  signupController,
} from "../../controllers/user-auth.controller.js";

/** Credential endpoints get a much tighter per-IP budget than the API default. */
const strict = { rateLimit: { max: 10, timeWindow: "1 minute" } };

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/users/auth/signup",
    { schema: { body: signupUserBodySchema }, config: strict },
    signupController,
  );
  fastify.post(
    "/users/auth/login",
    { schema: { body: loginUserBodySchema }, config: strict },
    loginController,
  );

  // Email confirmation for password signups. Public and strictly rate limited.
  fastify.post<{ Body: { token: string } }>(
    "/users/auth/verify-email",
    {
      schema: {
        body: {
          type: "object",
          properties: { token: { type: "string", minLength: 20, maxLength: 200 } },
          required: ["token"],
          additionalProperties: false,
        },
      },
      config: strict,
    },
    verifyEmailController,
  );
  fastify.post<{ Body: { email: string } }>(
    "/users/auth/verify-email/resend",
    { schema: { body: forgotPasswordBodySchema }, config: strict },
    resendVerificationController,
  );

  // Public: unauthenticated by design, so strictly rate limited.
  fastify.post<{ Body: { email: string } }>(
    "/users/auth/password/forgot",
    { schema: { body: forgotPasswordBodySchema }, config: strict },
    forgotPasswordController,
  );

  fastify.post<{ Body: { token: string; newPassword: string } }>(
    "/users/auth/password/reset",
    { schema: { body: resetPasswordBodySchema }, config: strict },
    resetPasswordController,
  );

  fastify.get("/users/auth/providers", authProvidersController);
  fastify.get("/users/auth/google", googleAuthController);
  fastify.get("/users/auth/google/callback", googleCallbackController);

  fastify.get("/users/auth/me", { preHandler: [fastify.authenticate] }, meController);
  fastify.post(
    "/users/auth/logout",
    { preHandler: [fastify.authenticate], schema: { querystring: logoutQuerySchema } },
    logoutController,
  );

  fastify.get(
    "/users/auth/sessions",
    { preHandler: [fastify.authenticate] },
    listSessionsController,
  );
  fastify.delete(
    "/users/auth/sessions",
    { preHandler: [fastify.authenticate] },
    revokeOtherSessionsController,
  );
  fastify.delete<{ Params: { sessionId: string } }>(
    "/users/auth/sessions/:sessionId",
    { preHandler: [fastify.authenticate] },
    revokeSessionController,
  );

  // GDPR self-service: portability and erasure. Export is a GET an API key may
  // also call (it is the owner's own data); delete is refused for keys by the
  // read-only rule, so in practice it is session-only.
  fastify.get("/users/me/export", { preHandler: [fastify.authenticate] }, exportAccountController);
  fastify.delete<{ Body: { password?: string } }>(
    "/users/me",
    {
      preHandler: [fastify.authenticate],
      config: strict,
      schema: {
        body: {
          type: "object",
          properties: { password: { type: "string", maxLength: 200 } },
          additionalProperties: false,
        },
      },
    },
    deleteAccountController,
  );

  fastify.post<{ Body: ChangePasswordInput }>(
    "/users/auth/password",
    {
      preHandler: [fastify.authenticate],
      schema: { body: changePassBodySchema },
    },
    changePasswordController,
  );
}
