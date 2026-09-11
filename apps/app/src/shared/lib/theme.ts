import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "webyz-theme";

const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

export const getTheme = (): Theme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

const applyTheme = (theme: Theme) => {
  document.documentElement.classList.toggle("dark", theme === "dark");
  notify();
};

/**
 * Called once before render: stored preference wins, otherwise follow the
 * OS. Applying the class on <html> up front avoids a light flash.
 */
export const initTheme = () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  const theme: Theme =
    stored === "dark" || stored === "light"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  applyTheme(theme);
};

/** What the OS asks for right now. */
const systemTheme = (): Theme =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

/**
 * Apply a theme for this page view only, without touching the stored
 * preference. An embedded dashboard takes its theme from the host page's
 * iframe URL, and a viewer of someone else's dashboard should not have their
 * own preference for the app overwritten by it.
 */
export const applyThemeForView = (theme: Theme | "system") => {
  applyTheme(theme === "system" ? systemTheme() : theme);
};

export const toggleTheme = () => {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(STORAGE_KEY, next);
  applyTheme(next);
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Current theme as reactive state; re-renders subscribers on toggle. */
export const useTheme = (): Theme =>
  useSyncExternalStore(subscribe, getTheme, () => "light");
