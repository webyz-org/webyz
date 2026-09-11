/**
 * The share token for a password-protected public dashboard.
 *
 * `POST /shared/:slug/unlock` hands one out for a correct password; every
 * analytics read for that site must then carry it as `X-Share-Token`. It is
 * kept per slug in sessionStorage so a reload inside the tab does not ask
 * again, and forgotten when the tab closes. One "current" token is held in
 * memory for the axios interceptor, set by the shared page while it is
 * mounted and cleared when it unmounts, so an owner's own dashboard never
 * sends a stray header.
 */

const STORAGE_PREFIX = "webyz-share-token:";

/** Fired by the axios interceptor when the API says the token is missing or expired. */
export const SHARE_LOCKED_EVENT = "webyz:share-locked";

let currentToken: string | null = null;

export const getCurrentShareToken = () => currentToken;

export const setCurrentShareToken = (token: string | null) => {
  currentToken = token;
};

export const readShareToken = (slug: string): string | null => {
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + slug);
  } catch {
    return null;
  }
};

export const storeShareToken = (slug: string, token: string) => {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + slug, token);
  } catch {
    // Storage blocked: the in-memory token still covers this page view.
  }
};

export const forgetShareToken = (slug: string) => {
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + slug);
  } catch {
    // Nothing to forget.
  }
};
