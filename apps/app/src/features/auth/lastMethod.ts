export type SignInMethod = "password" | "google";

const LAST_METHOD_STORAGE_KEY = "webyz-last-sign-in";

/**
 * How this browser last signed in, so the login page can mark that option
 * "Last used". Only the method is kept, never the address: a shared computer
 * should not hand the next person someone's email. Anything unreadable reads
 * as unknown, which just shows no badge.
 */
export const readLastSignInMethod = (): SignInMethod | null => {
  try {
    const value = localStorage.getItem(LAST_METHOD_STORAGE_KEY);
    return value === "password" || value === "google" ? value : null;
  } catch {
    return null;
  }
};

/** Called only once a sign-in has actually succeeded. */
export const rememberSignInMethod = (method: SignInMethod) => {
  try {
    localStorage.setItem(LAST_METHOD_STORAGE_KEY, method);
  } catch {
    // Storage blocked or full: the badge is a convenience, nothing depends on it.
  }
};
