/**
 * Runtime configuration for the dashboard.
 *
 * The API is same-origin by default: a self-hosted install serves the
 * dashboard and the API from one domain, with the reverse proxy sending
 * /api/*, /js/* and /health to the API and everything else here. That is why
 * a prebuilt image works for any domain without rebuilding. Set
 * VITE_API_BASE_URL at build time only when the API lives on another origin
 * (the hosted product runs app. and api. subdomains). The value is always an
 * absolute origin, so the install snippet shown to customers can never be a
 * relative "/js/script.js".
 *
 * In `pnpm dev` the values fall back to the local ports from CLAUDE.md.
 */
const trimOrigin = (value: string | undefined): string => value?.trim().replace(/\/+$/, "") ?? "";

// Resolved at build time: empty strings in a production bundle.
const DEV_API = import.meta.env.DEV ? "http://localhost:3042" : "";
const DEV_MARKETING = import.meta.env.DEV ? "http://localhost:3040" : "";

/** Origin of the API, no trailing slash. */
export const API_BASE_URL =
  trimOrigin(import.meta.env.VITE_API_BASE_URL) || DEV_API || window.location.origin;

/** Where the tracking script is served from, for the install snippet. */
export const TRACKER_SCRIPT_URL = `${API_BASE_URL}/js/script.js`;
export const TRACKER_ENDPOINT = `${API_BASE_URL}/api/v1/track`;

/** Server-side Google OAuth entrypoint; it redirects back to the SPA. */
export const GOOGLE_AUTH_URL = `${API_BASE_URL}/api/v1/users/auth/google`;

/**
 * The hosted product's marketing site, for the "Home" link and the legal links
 * on the auth screens. Optional and unset on self-hosted installs: an empty
 * value hides those links rather than pointing at nothing.
 */
export const MARKETING_URL = trimOrigin(import.meta.env.VITE_MARKETING_URL) || DEV_MARKETING;
