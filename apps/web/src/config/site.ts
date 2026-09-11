/**
 * Where the dashboard app and API live. Both are configurable because the
 * marketing site is deployed separately from the product.
 */
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3041";

export const API_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3042";

/** This site's own public origin, for canonical URLs, Open Graph and the sitemap. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3040").replace(/\/$/, "");

export const SIGNUP_URL = `${APP_URL}/signup`;
export const LOGIN_URL = `${APP_URL}/login`;

/**
 * The repository the landing page's open-source section links to. Taken from
 * this checkout's git remote; override per deployment if that changes.
 */
export const GITHUB_URL =
  process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/nihalnclt/webyz";
