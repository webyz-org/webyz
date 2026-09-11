import dotenv from "dotenv";
dotenv.config();

import { parseTrustProxy } from "./trust-proxy.js";

const bool = (v: string | undefined, fallback = false) =>
  v === undefined ? fallback : v === "true" || v === "1";

export const NODE_ENV = process.env.NODE_ENV || "development";
export const IS_PROD = NODE_ENV === "production";
export const PORT = Number(process.env.PORT) || 3042;
export const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

/**
 * Which proxies may set the client address; see config/trust-proxy.ts. Throws
 * at boot in production when unset, because both defaults are wrong there.
 */
export const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY, IS_PROD);

/**
 * REGISTRATION=open lets anyone sign up (the hosted product). Anything else
 * closes signups after the first account exists (the self-host default); see
 * core/auth/registration.ts.
 */
export const REGISTRATION_OPEN = (process.env.REGISTRATION ?? "open").trim().toLowerCase() === "open";

export const DATABASE_URL = process.env.DATABASE_URL!;

// Single source of truth for ClickHouse. CLICKHOUSE_HOST is accepted as a
// legacy alias so existing .env files keep working.
export const CLICKHOUSE_URL =
  process.env.CLICKHOUSE_URL ||
  process.env.CLICKHOUSE_HOST ||
  "http://localhost:8123";
export const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || "default";
export const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || "";
export const CLICKHOUSE_DB = process.env.CLICKHOUSE_DB || "webyz_analytics";

export const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
export const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

export const MAXMIND_LICENSE_KEY = process.env.MAXMIND_LICENSE_KEY ?? "";

// Where the dashboard SPA lives. Used for OAuth redirects and checkout returns.
export const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3041";
// Public marketing site.
// The marketing site is optional (self-hosters normally run without it), so
// in production an unset value means "none": it drops out of the CORS
// allowlist and nothing links to it. Development keeps the local port.
export const MARKETING_URL = process.env.MARKETING_URL ?? (IS_PROD ? "" : "http://localhost:3040");
export const APP_URL = process.env.APP_URL ?? FRONTEND_URL;

export const CORS_ORIGINS = (
  process.env.CORS_ORIGINS ||
  // The static example pages (examples/tracker) live on 127.0.0.1:5500 in
  // development only; production allows exactly the configured front ends.
  [FRONTEND_URL, MARKETING_URL, IS_PROD ? "" : "http://127.0.0.1:5500"].join(",")
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
export const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? "";
export const GOOGLE_OAUTH_ENABLED = Boolean(
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI,
);

// Google Search Console. Reuses the login OAuth client; the callback is its
// own endpoint so connecting a site never collides with the sign-in flow.
// Defaults to the login redirect's origin + /api/v1/gsc/callback; both URIs
// must be registered in the Google Cloud OAuth client.
export const GSC_REDIRECT_URI =
  process.env.GSC_REDIRECT_URI ||
  (GOOGLE_REDIRECT_URI
    ? new URL("/api/v1/gsc/callback", GOOGLE_REDIRECT_URI).toString()
    : "");
export const GSC_ENABLED = Boolean(
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GSC_REDIRECT_URI,
);

/** 64 hex chars (32 bytes) for AES-256-GCM at rest; see core/gsc/token-crypto.ts. */
export const ENCRYPTION_KEY = (process.env.ENCRYPTION_KEY ?? "").trim();

/**
 * Drop events whose page hostname is not the site's domain (or a subdomain,
 * or localhost). Stops a leaked site id being used to pollute someone else's
 * numbers. "off" disables it for setups that serve one site from many hosts.
 */
export const INGEST_HOSTNAME_CHECK = (process.env.INGEST_HOSTNAME_CHECK ?? "on").trim().toLowerCase() !== "off";

/**
 * Drop events from known data-centre, hosting and VPN address ranges
 * (core/bots/datacenter-ips.ts). `off` disables it. The ranges come from the
 * comma-separated URLs in DATACENTER_IP_LISTS, fetched daily by the
 * `update-datacenter-ips` job into geo/datacenter-ips.txt; the default is the
 * MIT-licensed X4BNet list, rebuilt from provider ASNs by its maintainers,
 * plus Google Cloud's own published ranges, which that list only partly
 * covers. A JSON source is reduced to the CIDRs it quotes.
 */
export const BOT_DATACENTER_FILTER = (process.env.BOT_DATACENTER_FILTER ?? "on").trim().toLowerCase() !== "off";
export const DATACENTER_IP_LISTS = (
  process.env.DATACENTER_IP_LISTS ??
  "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/datacenter/ipv4.txt," +
    "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/datacenter/ipv6.txt," +
    "https://www.gstatic.com/ipranges/cloud.json"
)
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

/**
 * Ranges never dropped even when a deny list carries them. Default: Apple's
 * published iCloud Private Relay egress ranges, which sit inside Akamai and
 * Cloudflare hosting space and belong to ordinary iPhone users.
 */
export const DATACENTER_IP_ALLOWLISTS = (
  process.env.DATACENTER_IP_ALLOWLISTS ?? "https://mask-api.icloud.com/egress-ip-ranges.csv"
)
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

/**
 * Referrer spam domains (core/bots/referrer-spam.ts); a request whose
 * referrer is one of them, or a subdomain, is dropped. Default: the Matomo
 * community list, the same one Plausible and Matomo use. Empty disables it.
 */
export const REFERRER_SPAM_LISTS = (
  process.env.REFERRER_SPAM_LISTS ??
  "https://raw.githubusercontent.com/matomo-org/referrer-spam-list/master/spammers.txt"
)
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

/**
 * Behavioural filter (core/bots/clusters.ts): flag and drop groups of
 * traffic that behave like a browser farm. `off` disables both the detection
 * job and the ingest check.
 */
export const BOT_CLUSTER_FILTER = (process.env.BOT_CLUSTER_FILTER ?? "on").trim().toLowerCase() !== "off";

// ─── Billing (Paddle) ─────────────────────────────────────────────────────────
// Paddle is the merchant of record, which is why it is the provider: it sells,
// charges tax and pays out, so no card ever reaches this server.
export const PADDLE_API_KEY = (process.env.PADDLE_API_KEY ?? "").trim();
/** Secret of the notification destination, used to verify every webhook. */
export const PADDLE_WEBHOOK_SECRET = (process.env.PADDLE_WEBHOOK_SECRET ?? "").trim();
/**
 * Public client token. It can only open a checkout, so it is served to the
 * dashboard by the API rather than baked into the bundle: one prebuilt image
 * then works for any installation.
 */
export const PADDLE_CLIENT_TOKEN = (process.env.PADDLE_CLIENT_TOKEN ?? "").trim();
/**
 * Which Paddle to talk to. Defaults from the key itself (sandbox keys carry
 * "sdbx"), because pointing a sandbox key at production is a silent failure.
 */
export const PADDLE_ENVIRONMENT: "sandbox" | "production" =
  (process.env.PADDLE_ENVIRONMENT ?? "").trim().toLowerCase() === "production"
    ? "production"
    : (process.env.PADDLE_ENVIRONMENT ?? "").trim().toLowerCase() === "sandbox"
      ? "sandbox"
      : PADDLE_API_KEY.includes("sdbx")
        ? "sandbox"
        : "production";
/**
 * Refuse webhook deliveries from addresses that are not Paddle's, as listed by
 * Paddle itself (GET /ips, refreshed hourly). On in production, off in
 * development, because a dev tunnel delivers from its own address. Behind a
 * reverse proxy this needs TRUST_PROXY to be right, or every delivery looks
 * like it came from the proxy and is refused.
 */
export const PADDLE_IP_ALLOWLIST =
  (process.env.PADDLE_IP_ALLOWLIST ?? (IS_PROD ? "on" : "off")).trim().toLowerCase() === "on";
/**
 * Billing needs both halves: the API key to manage subscriptions and the
 * client token to open checkout. With either missing no plan is purchasable,
 * which is what GET /plans reports and both front ends render.
 */
export const BILLING_ENABLED = Boolean(PADDLE_API_KEY && PADDLE_CLIENT_TOKEN);

// ─── Email ────────────────────────────────────────────────────────────────────
// With no provider configured the console transport is used, which logs the
// message. That keeps signup and password reset usable in development.
export const EMAIL_FROM = process.env.EMAIL_FROM ?? "Webyz <onboarding@resend.dev>";
export const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
export const SMTP_URL = process.env.SMTP_URL ?? "";

/**
 * Whether a password signup must confirm its address before it can sign in
 * and before its trial starts. "required" and "off" are explicit; "auto", the
 * default, requires it exactly when a mail provider is configured, so a
 * self-host without RESEND_API_KEY is not locked behind a link nobody can
 * receive while the hosted product, which sends mail, always verifies.
 */
export const EMAIL_VERIFICATION = (process.env.EMAIL_VERIFICATION ?? "auto").trim().toLowerCase();
export const EMAIL_VERIFICATION_REQUIRED =
  EMAIL_VERIFICATION === "required" || (EMAIL_VERIFICATION === "auto" && Boolean(RESEND_API_KEY));
/** How long a confirmation link stays valid. */
export const EMAIL_VERIFICATION_TTL_HOURS = Number(process.env.EMAIL_VERIFICATION_TTL_HOURS ?? 24);

/** How long a password reset link stays valid. */
export const PASSWORD_RESET_TTL_MINUTES = Number(
  process.env.PASSWORD_RESET_TTL_MINUTES ?? 30,
);
