import crypto from "crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import {
  changePassword,
  getUserById,
  loginUser,
  registerUser,
  upsertGoogleUser,
} from "../core/auth/users.service.js";
import {
  ChangePasswordInput,
  LoginUserInput,
  RegisterUserInput,
} from "../core/auth/types.js";
import {
  getRequestMeta,
  getSessionCookieOptions,
} from "../core/auth/helper.js";
import {
  createSession,
  listSessions,
  revokeAllSessions,
  revokeOtherSessions,
  revokeSession,
} from "../core/auth/sessions.service.js";
import { SESSION_COOKIE_NAME } from "../config/constants.js";
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  getGoogleUserInfo,
  storeOAuthState,
  validateAndConsumeOAuthState,
} from "../core/auth/google-auth.service.js";
import { FRONTEND_URL, GOOGLE_OAUTH_ENABLED, RESEND_API_KEY } from "../config/env.js";
import { sendResponse } from "../http/helper/send-response.js";
import {
  requestPasswordReset,
  resetPassword,
} from "../core/auth/password-reset.service.js";
import { forbidden } from "../errors/http-errors.js";
import { deleteAccount, exportAccountData } from "../core/auth/account.service.js";
import { registrationAllowed } from "../core/auth/registration.js";
import { resendVerification, verificationRequired, verifyEmail } from "../core/auth/email-verification.service.js";

export async function signupController(
  request: FastifyRequest<{ Body: RegisterUserInput }>,
  reply: FastifyReply,
) {
  const { requiresVerification, ...user } = await registerUser(request.ctx, request.body);

  // Unverified accounts are not signed in: the link in the email does that.
  if (requiresVerification) {
    return sendResponse(reply, { user, requiresVerification: true }, { statusCode: 201 });
  }

  const session = await createSession(
    request.ctx,
    user.id,
    getRequestMeta(request),
  );

  reply.setCookie(SESSION_COOKIE_NAME, session.id, getSessionCookieOptions());
  return sendResponse(reply, { user, requiresVerification: false }, { statusCode: 201 });
}

/** Redeem a confirmation link. Signs the user in on success. */
export async function verifyEmailController(
  request: FastifyRequest<{ Body: { token: string } }>,
  reply: FastifyReply,
) {
  const user = await verifyEmail(request.ctx, request.body.token);
  const session = await createSession(request.ctx, user.id, getRequestMeta(request));
  reply.setCookie(SESSION_COOKIE_NAME, session.id, getSessionCookieOptions());
  return sendResponse(reply, { user });
}

/** Always the same answer, so addresses cannot be enumerated. */
export async function resendVerificationController(
  request: FastifyRequest<{ Body: { email: string } }>,
  reply: FastifyReply,
) {
  await resendVerification(request.ctx, request.body.email);
  return sendResponse(reply, {
    message: "If that address has an unconfirmed account, a new link is on its way.",
  });
}

export async function loginController(
  request: FastifyRequest<{ Body: LoginUserInput }>,
  reply: FastifyReply,
) {
  const user = await loginUser(request.ctx, request.body);
  const session = await createSession(
    request.ctx,
    user.id,
    getRequestMeta(request),
  );

  reply.setCookie(SESSION_COOKIE_NAME, session.id, getSessionCookieOptions());
  return sendResponse(reply, { user });
}

export async function logoutController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { userId, sessionId } = request.session;
  const logoutAll =
    (request.query as { all?: string } | undefined)?.all === "true";

  if (logoutAll) {
    await revokeAllSessions(request.ctx, userId);
  } else {
    await revokeSession(request.ctx, sessionId);
  }

  reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  return sendResponse(reply, {
    message: logoutAll ? "Logged out from all devices" : "Logged out",
  });
}

export async function meController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const user = await getUserById(request.ctx, request.session.userId);
  return sendResponse(reply, { user });
}

export async function listSessionsController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const sessions = await listSessions(request.ctx, request.session.userId);

  const withCurrent = sessions.map((s) => ({
    ...s,
    isCurrent: s.id === request.session.sessionId,
  }));

  return sendResponse(reply, { sessions: withCurrent });
}

export async function revokeOtherSessionsController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { count } = await revokeOtherSessions(
    request.ctx,
    request.session.userId,
    request.session.sessionId,
  );

  return sendResponse(reply, {
    message: `Revoked ${count} other session(s)`,
  });
}

export async function revokeSessionController(
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
) {
  const sessions = await listSessions(request.ctx, request.session.userId);
  const owns = sessions.some((s) => s.id === request.params.sessionId);

  if (!owns) {
    throw forbidden("You do not own that session");
  }

  await revokeSession(request.ctx, request.params.sessionId);
  return sendResponse(reply, { message: "Session revoked" });
}

export async function changePasswordController(
  request: FastifyRequest<{ Body: ChangePasswordInput }>,
  reply: FastifyReply,
) {
  const { userId, sessionId } = request.session;

  await changePassword(request.ctx, userId, request.body);

  await revokeOtherSessions(request.ctx, userId, sessionId);

  return sendResponse(reply, {
    message: "Password updated. Other devices have been logged out.",
  });
}

/**
 * Which sign-in methods this server supports. Public, so the login and signup
 * screens can hide the Google button when the OAuth client is not configured
 * instead of sending the browser to Google with an empty client id.
 */
export async function authProvidersController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  return sendResponse(reply, {
    google: GOOGLE_OAUTH_ENABLED,
    // False once registration is closed and an account exists; the login
    // screen then hides the signup link and the signup page explains.
    registration: await registrationAllowed(request.ctx),
    // Whether a password signup must confirm its address before signing in.
    emailVerification: verificationRequired(),
    // Whether this server can send mail at all; the forgot-password page
    // explains instead of promising an email that cannot arrive.
    email: Boolean(RESEND_API_KEY),
  });
}

const authErrorRedirect = (reason: string) =>
  `${FRONTEND_URL}/auth/error?reason=${encodeURIComponent(reason)}`;

/**
 * Google's `error` query value is provider-controlled text. Only a plain
 * snake_case token (access_denied, invalid_request, ...) is passed through;
 * anything else collapses to a generic reason so nothing unexpected is
 * reflected into the redirect.
 */
const safeProviderReason = (error: string) =>
  /^[a-z_]{1,40}$/.test(error) ? error : "provider_error";

/** Everything the account holds, as one JSON download. Analytics are per-site CSVs. */
export async function exportAccountController(request: FastifyRequest, reply: FastifyReply) {
  const data = await exportAccountData(request.ctx, request.session.userId);
  const day = new Date().toISOString().slice(0, 10);
  return reply
    .header("Content-Type", "application/json; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="webyz-account-${day}.json"`)
    .header("Cache-Control", "no-store")
    .send(JSON.stringify(data, null, 2));
}

/** Irreversible. The session cookie is cleared in the same response. */
export async function deleteAccountController(
  request: FastifyRequest<{ Body: { password?: string } }>,
  reply: FastifyReply,
) {
  const result = await deleteAccount(request.ctx, request.session.userId, { password: request.body?.password });
  reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  return sendResponse(reply, result);
}

export async function googleAuthController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  // Both OAuth endpoints are browser navigations, not API calls, so an
  // unconfigured server answers with the same redirect the rest of the flow
  // uses rather than a JSON error the user would see raw in the tab.
  if (!GOOGLE_OAUTH_ENABLED) {
    return reply.redirect(authErrorRedirect("not_configured"));
  }

  const state = crypto.randomBytes(32).toString("hex");
  await storeOAuthState(request.ctx, state);
  return reply.redirect(buildGoogleAuthUrl(state));
}

export async function googleCallbackController(
  request: FastifyRequest<{
    Querystring: { code?: string; state?: string; error?: string };
  }>,
  reply: FastifyReply,
) {
  const { code, state, error } = request.query;

  if (!GOOGLE_OAUTH_ENABLED) {
    return reply.redirect(authErrorRedirect("not_configured"));
  }

  if (error) {
    return reply.redirect(authErrorRedirect(safeProviderReason(error)));
  }

  if (!code || !state) {
    return reply.redirect(authErrorRedirect("missing_params"));
  }

  const stateValid = await validateAndConsumeOAuthState(request.ctx, state);
  if (!stateValid) {
    return reply.redirect(authErrorRedirect("invalid_state"));
  }

  // From here on the failures are Google's (token exchange, userinfo) or ours
  // (user upsert, session). The user is mid-redirect, so a thrown error would
  // land them on a JSON 500 page; log it and send them to the error screen.
  try {
    const googleTokens = await exchangeCodeForTokens(code);
    const googleUser = await getGoogleUserInfo(googleTokens.access_token);
    const user = await upsertGoogleUser(request.ctx, googleUser);

    const session = await createSession(
      request.ctx,
      user.id,
      getRequestMeta(request),
    );

    return reply
      .setCookie(SESSION_COOKIE_NAME, session.id, getSessionCookieOptions())
      .redirect(`${FRONTEND_URL}/auth/success`);
  } catch (err) {
    if ((err as { code?: string })?.code === "REGISTRATION_DISABLED") {
      return reply.redirect(authErrorRedirect("registration_disabled"));
    }
    request.log.error({ err }, "Google sign-in failed after callback");
    return reply.redirect(authErrorRedirect("exchange_failed"));
  }
}

export async function forgotPasswordController(
  request: FastifyRequest<{ Body: { email: string } }>,
  reply: FastifyReply,
) {
  await requestPasswordReset(request.ctx, request.body.email);

  // Deliberately identical whether or not the address exists, so this cannot
  // be used to enumerate accounts.
  return sendResponse(reply, {
    message:
      "If that email belongs to an account, a reset link is on its way.",
  });
}

export async function resetPasswordController(
  request: FastifyRequest<{ Body: { token: string; newPassword: string } }>,
  reply: FastifyReply,
) {
  await resetPassword(request.ctx, request.body);

  return sendResponse(reply, {
    message: "Password updated. Please log in with your new password.",
  });
}
