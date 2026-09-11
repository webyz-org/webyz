/**
 * A comma-separated list of URLs from the environment.
 *
 * Empty and unset both mean "use the default": the compose files pass every
 * optional variable through as `${NAME:-}`, so an operator who never set it
 * hands the API an empty string, and the first hosted deploy read that as an
 * empty list and never refreshed the bot lists. Disabling is explicit:
 * `off` (or `none`) yields an empty list.
 */
export const listEnv = (value: string | undefined, fallback: string[]): string[] => {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return fallback;
  if (/^(off|none|disabled)$/i.test(trimmed)) return [];
  return trimmed
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
};
