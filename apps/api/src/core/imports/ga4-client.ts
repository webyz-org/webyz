import {
  GA4_IMPORT_REDIRECT_URI,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
} from "../../config/env.js";

/**
 * Thin fetch-based client for the Google OAuth, Analytics Admin and Analytics
 * Data APIs, in the style of core/gsc/gsc-client.ts: no Google SDK for a
 * handful of endpoints. Both APIs must be enabled in the Google Cloud project
 * that owns the login OAuth client, and the import redirect URI registered on
 * it (docs/configuration.md).
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";
const DATA_API = "https://analyticsdata.googleapis.com/v1beta";

/** Read-only Analytics access plus the email, shown so the owner knows which account. */
const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "openid",
  "email",
].join(" ");

/** Google says the grant is gone or was never given for this property. */
export class Ga4AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Ga4AuthError";
  }
}

/** Google's per-property quota is spent; the job waits and retries. */
export class Ga4QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Ga4QuotaError";
  }
}

export function buildGa4AuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GA4_IMPORT_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    state,
    access_type: "offline",
    // A refresh token only comes back with consent; the import outlives the
    // hour an access token lasts.
    prompt: "consent",
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

const postToken = async (body: Record<string, string>): Promise<Response> =>
  fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      ...body,
    }),
  });

export async function exchangeGa4Code(code: string): Promise<TokenResponse> {
  const res = await postToken({
    code,
    redirect_uri: GA4_IMPORT_REDIRECT_URI,
    grant_type: "authorization_code",
  });
  if (!res.ok) throw new Error(`GA4 token exchange failed: ${await res.text()}`);
  return res.json() as Promise<TokenResponse>;
}

export async function refreshGa4AccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await postToken({ refresh_token: refreshToken, grant_type: "refresh_token" });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400 && body.includes("invalid_grant")) {
      throw new Ga4AuthError("Google access was revoked or expired");
    }
    throw new Error(`GA4 token refresh failed: ${body}`);
  }
  return res.json() as Promise<TokenResponse>;
}

/**
 * Best effort: a failed revoke must not keep a finished import alive. Never
 * called out to from a test run (Node sets NODE_TEST_CONTEXT in every test
 * process), the same guard core/email/transports.ts uses.
 */
export async function revokeGa4Token(token: string): Promise<void> {
  if (process.env.NODE_TEST_CONTEXT) return;
  try {
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" });
  } catch {
    // Ignored; the stored token is deleted regardless.
  }
}

export async function getGoogleAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return ((await res.json()) as { email?: string }).email ?? null;
  } catch {
    return null;
  }
}

const authHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
});

const failure = async (res: Response, what: string): Promise<Error> => {
  const body = await res.text();
  if (res.status === 401 || res.status === 403) return new Ga4AuthError(`${what} rejected: ${body}`);
  if (res.status === 429 || body.includes("RESOURCE_EXHAUSTED")) {
    return new Ga4QuotaError(`${what} quota exhausted: ${body}`);
  }
  return new Error(`${what} failed (${res.status}): ${body}`);
};

export type Ga4Property = {
  /** Numeric id, as in `properties/123456789`. */
  id: string;
  name: string;
  account: string;
};

/** Every GA4 property the account can read, across its accounts. */
export async function listGa4Properties(accessToken: string): Promise<Ga4Property[]> {
  const properties: Ga4Property[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ pageSize: "200" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${ADMIN_API}/accountSummaries?${params}`, {
      headers: authHeaders(accessToken),
    });
    if (!res.ok) throw await failure(res, "GA4 account list");
    const data = (await res.json()) as {
      accountSummaries?: Array<{
        displayName?: string;
        propertySummaries?: Array<{ property: string; displayName?: string }>;
      }>;
      nextPageToken?: string;
    };
    for (const account of data.accountSummaries ?? []) {
      for (const property of account.propertySummaries ?? []) {
        properties.push({
          id: property.property.replace(/^properties\//, ""),
          name: property.displayName ?? property.property,
          account: account.displayName ?? "",
        });
      }
    }
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);
  return properties;
}

export type Ga4PropertyDetails = {
  /** RFC 3339; data cannot predate it. */
  createTime: string | null;
  timeZone: string | null;
};

export async function getGa4Property(
  accessToken: string,
  propertyId: string,
): Promise<Ga4PropertyDetails> {
  const res = await fetch(`${ADMIN_API}/properties/${encodeURIComponent(propertyId)}`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw await failure(res, "GA4 property");
  const data = (await res.json()) as { createTime?: string; timeZone?: string };
  return { createTime: data.createTime ?? null, timeZone: data.timeZone ?? null };
}

/**
 * API names of every dimension and metric the property offers, so the import
 * skips a report Google cannot serve (and says so) instead of failing on it.
 */
export async function getGa4Metadata(
  accessToken: string,
  propertyId: string,
): Promise<{ dimensions: Set<string>; metrics: Set<string> }> {
  const res = await fetch(
    `${DATA_API}/properties/${encodeURIComponent(propertyId)}/metadata`,
    { headers: authHeaders(accessToken) },
  );
  if (!res.ok) throw await failure(res, "GA4 metadata");
  const data = (await res.json()) as {
    dimensions?: Array<{ apiName: string }>;
    metrics?: Array<{ apiName: string }>;
  };
  return {
    dimensions: new Set((data.dimensions ?? []).map((d) => d.apiName)),
    metrics: new Set((data.metrics ?? []).map((m) => m.apiName)),
  };
}

export type Ga4StringFilter = { fieldName: string; value: string };

export type Ga4ReportRequest = {
  startDate: string;
  endDate: string;
  dimensions: string[];
  metrics: string[];
  /** All must match (an AND of exact string matches). */
  filters?: Ga4StringFilter[];
  limit: number;
  offset: number;
};

export type Ga4ReportPage = {
  /** Dimension values then metric values, in request order, as strings. */
  rows: Array<{ dimensions: string[]; metrics: string[] }>;
  rowCount: number;
};

const dimensionFilter = (filters: Ga4StringFilter[] | undefined) => {
  if (!filters?.length) return undefined;
  const expressions = filters.map((f) => ({
    filter: { fieldName: f.fieldName, stringFilter: { matchType: "EXACT", value: f.value } },
  }));
  return expressions.length === 1 ? expressions[0] : { andGroup: { expressions } };
};

/** One page of `runReport`. */
export async function runGa4Report(
  accessToken: string,
  propertyId: string,
  request: Ga4ReportRequest,
): Promise<Ga4ReportPage> {
  const res = await fetch(
    `${DATA_API}/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        dateRanges: [{ startDate: request.startDate, endDate: request.endDate }],
        dimensions: request.dimensions.map((name) => ({ name })),
        metrics: request.metrics.map((name) => ({ name })),
        dimensionFilter: dimensionFilter(request.filters),
        limit: String(request.limit),
        offset: String(request.offset),
        // Rows with all-zero metrics carry nothing to import.
        keepEmptyRows: false,
      }),
    },
  );
  if (!res.ok) throw await failure(res, "GA4 report");
  const data = (await res.json()) as {
    rows?: Array<{
      dimensionValues?: Array<{ value?: string }>;
      metricValues?: Array<{ value?: string }>;
    }>;
    rowCount?: number;
  };
  return {
    rows: (data.rows ?? []).map((row) => ({
      dimensions: (row.dimensionValues ?? []).map((v) => v.value ?? ""),
      metrics: (row.metricValues ?? []).map((v) => v.value ?? "0"),
    })),
    rowCount: data.rowCount ?? 0,
  };
}
