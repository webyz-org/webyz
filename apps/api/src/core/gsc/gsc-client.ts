import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GSC_REDIRECT_URI,
} from "../../config/env.js";

/**
 * Thin fetch-based client for Google's OAuth and Search Console APIs, in the
 * same style as core/auth/google-auth.service.ts. No Google SDK on purpose:
 * five endpoints do not justify the googleapis dependency.
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GSC_API_BASE = "https://www.googleapis.com/webmasters/v3";

/** Read-only Search Console access plus the email for the settings UI. */
const GSC_SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "openid",
  "email",
].join(" ");

/** Thrown when Google says the grant is gone (revoked / expired refresh token). */
export class GscAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GscAuthError";
  }
}

export function buildGscAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GSC_REDIRECT_URI,
    response_type: "code",
    scope: GSC_SCOPES,
    state,
    access_type: "offline",
    // Without prompt=consent Google only issues a refresh token on the very
    // first authorization; a reconnect would silently come back without one.
    prompt: "consent",
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

export async function exchangeGscCode(code: string): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GSC_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    throw new Error(`GSC token exchange failed: ${await res.text()}`);
  }
  return res.json() as Promise<TokenResponse>;
}

export async function refreshGscAccessToken(
  refreshToken: string,
): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // invalid_grant = the user revoked access or the token expired; the
    // connection needs a fresh authorization, not a retry.
    if (res.status === 400 && body.includes("invalid_grant")) {
      throw new GscAuthError("Refresh token no longer valid");
    }
    throw new Error(`GSC token refresh failed: ${body}`);
  }
  return res.json() as Promise<TokenResponse>;
}

/** Best effort: a failed revoke must not block disconnecting locally. */
export async function revokeGscToken(token: string): Promise<void> {
  try {
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
    });
  } catch {
    // Ignored; the stored token is deleted regardless.
  }
}

export async function getGscAccountEmail(
  accessToken: string,
): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}

export type GscProperty = {
  siteUrl: string;
  permissionLevel: string;
};

/** Properties the connected account can read, including sc-domain: ones. */
export async function listGscProperties(
  accessToken: string,
): Promise<GscProperty[]> {
  const res = await fetch(`${GSC_API_BASE}/sites`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 401 || res.status === 403) {
    throw new GscAuthError(`GSC sites list rejected: ${await res.text()}`);
  }
  if (!res.ok) {
    throw new Error(`GSC sites list failed: ${await res.text()}`);
  }

  const data = (await res.json()) as { siteEntry?: GscProperty[] };
  return (data.siteEntry ?? []).filter(
    (site) => site.permissionLevel !== "siteUnverifiedUser",
  );
}

export type GscDimension = "query" | "page" | "country" | "device";

export type GscQueryRequest = {
  startDate: string; // YYYY-MM-DD, inclusive
  endDate: string; // YYYY-MM-DD, inclusive
  dimensions?: GscDimension[];
  rowLimit?: number;
  startRow?: number;
  type?: "web";
};

export type GscRow = {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

/**
 * searchAnalytics.query for one property. With no dimensions Google returns a
 * single totals row, which is how the summary strip gets exact aggregates.
 */
export async function queryGscSearchAnalytics(
  accessToken: string,
  propertyUri: string,
  body: GscQueryRequest,
): Promise<GscRow[]> {
  const res = await fetch(
    `${GSC_API_BASE}/sites/${encodeURIComponent(propertyUri)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (res.status === 401 || res.status === 403) {
    throw new GscAuthError(`GSC query rejected: ${await res.text()}`);
  }
  if (!res.ok) {
    throw new Error(`GSC query failed: ${await res.text()}`);
  }

  const data = (await res.json()) as { rows?: GscRow[] };
  return data.rows ?? [];
}
