import { createAppError } from "./app-error.js";

export const invalidPeriod = (period: string) =>
  createAppError("Invalid analytics period", {
    code: "INVALID_PERIOD",
    statusCode: 400,
    details: { period },
  });

export const siteAccessDenied = () =>
  createAppError("You do not have access to this site", {
    code: "SITE_ACCESS_DENIED",
    statusCode: 403,
  });

/**
 * The dashboard is shared but behind a password, and the request carried no
 * valid share token. 401 with its own code so the public page can show the
 * password prompt instead of "no access".
 */
export const sharePasswordRequired = () =>
  createAppError("This shared dashboard needs a password", {
    code: "SHARE_PASSWORD_REQUIRED",
    statusCode: 401,
  });

export const sharePasswordInvalid = () =>
  createAppError("Wrong password", {
    code: "SHARE_PASSWORD_INVALID",
    statusCode: 401,
  });

/**
 * The account's plan does not include this feature. 403 with a stable code so
 * the dashboard can tell "upgrade to use this" from a real authorization
 * failure or a server error. `feature` is the catalog key; `plan` the current
 * plan's display name. Both also appear in the message because `details` is
 * stripped in production.
 */
export const featureNotAvailable = (input: { feature: string; label: string; plan: string }) =>
  createAppError(`${input.label} is not included in the ${input.plan} plan. Upgrade to use it.`, {
    code: "FEATURE_NOT_AVAILABLE",
    statusCode: 403,
    details: { feature: input.feature, plan: input.plan },
  });

// ─── Email verification ───────────────────────────────────────────────────────

export const emailNotVerified = () =>
  createAppError("Confirm your email address first. We sent you a link; you can ask for a new one below.", {
    code: "EMAIL_NOT_VERIFIED",
    statusCode: 403,
  });

// ─── API keys ─────────────────────────────────────────────────────────────────

/** Bearer-token requests may read anything the owner can read, and change nothing. */
export const apiKeyReadOnly = () =>
  createAppError("API keys are read-only. Use the dashboard to make changes.", {
    code: "API_KEY_READ_ONLY",
    statusCode: 403,
  });

export const tooManyApiKeys = (max: number) =>
  createAppError(`An account can hold at most ${max} active API keys. Revoke one first.`, {
    code: "TOO_MANY_API_KEYS",
    statusCode: 409,
    details: { max },
  });

// ─── Google Search Console ────────────────────────────────────────────────────

export const gscNotConfigured = () =>
  createAppError("Google Search Console is not configured on this server", {
    code: "GSC_NOT_CONFIGURED",
    statusCode: 501,
  });

export const gscNotConnected = () =>
  createAppError("This site is not connected to Google Search Console", {
    code: "GSC_NOT_CONNECTED",
    statusCode: 409,
  });

export const gscNoProperty = () =>
  createAppError("No Search Console property selected for this site", {
    code: "GSC_NO_PROPERTY",
    statusCode: 409,
  });

/** The stored refresh token was revoked or expired; reconnect required. */
export const gscReauthRequired = () =>
  createAppError("Google Search Console access expired, reconnect the site", {
    code: "GSC_REAUTH_REQUIRED",
    statusCode: 409,
  });

// ─── Team members ─────────────────────────────────────────────────────────────

export const teamSeatsExhausted = (input: { planName: string; limit: number; used: number }) =>
  createAppError(
    `The ${input.planName} plan allows ${input.limit} ${input.limit === 1 ? "person" : "people"} on a site, including the owner. Upgrade to add more.`,
    { code: "TEAM_SEATS_EXHAUSTED", statusCode: 403, details: { limit: input.limit, used: input.used } },
  );

export const invitationExpired = () =>
  createAppError("This invitation has expired. Ask for a new one.", {
    code: "INVITATION_EXPIRED",
    statusCode: 410,
  });

export const invitationEmailMismatch = (email: string) =>
  createAppError(`This invitation was sent to ${email}. Sign in with that account to accept it.`, {
    code: "INVITATION_EMAIL_MISMATCH",
    statusCode: 403,
  });

// ─── Imports ──────────────────────────────────────────────────────────────────

export const importNotConfigured = () =>
  createAppError("Google Analytics import is not configured on this server", {
    code: "IMPORT_NOT_CONFIGURED",
    statusCode: 501,
  });

export const importNotConnected = () =>
  createAppError("Connect a Google account first. The connection lasts an hour; connect again if it has expired.", {
    code: "IMPORT_NOT_CONNECTED",
    statusCode: 409,
  });

export const importReauthRequired = () =>
  createAppError("Google no longer accepts this connection. Connect your Google account again.", {
    code: "IMPORT_REAUTH_REQUIRED",
    statusCode: 409,
  });

export const importLimitReached = (max: number) =>
  createAppError(`A site can hold up to ${max} imports at a time. Delete one before importing again.`, {
    code: "IMPORT_LIMIT",
    statusCode: 409,
    details: { max },
  });

export const importOverlaps = (existing: { start: string; end: string }) =>
  createAppError(
    `These dates overlap an existing import (${existing.start} to ${existing.end}), and a day can only be imported once. Pick dates outside it, or delete that import first.`,
    { code: "IMPORT_OVERLAP", statusCode: 409, details: existing },
  );

export const importNothingToImport = (firstTrackedDay: string) =>
  createAppError(
    `Nothing to import in that range: Webyz has tracked this site since ${firstTrackedDay}, and imported days must come before it.`,
    { code: "IMPORT_EMPTY_RANGE", statusCode: 400, details: { firstTrackedDay } },
  );

export const importPropertyNotFound = () =>
  createAppError("That Google Analytics property is not available to the connected account.", {
    code: "IMPORT_PROPERTY_NOT_FOUND",
    statusCode: 404,
  });

export const importNotFound = () =>
  createAppError("Import not found", { code: "IMPORT_NOT_FOUND", statusCode: 404 });

export const exportEmpty = () =>
  createAppError("There is no tracked data to export for this site yet.", {
    code: "EXPORT_EMPTY",
    statusCode: 404,
  });

export const exportNotFound = () =>
  createAppError("That export is not available any more. Start a new one.", {
    code: "EXPORT_NOT_FOUND",
    statusCode: 404,
  });
