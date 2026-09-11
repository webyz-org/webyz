import { FastifyRequest } from "fastify";

export const extractHostname = (
  url: string | undefined,
  request: FastifyRequest,
): string => {
  if (url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname;
    } catch {
      // If URL parsing fails, try to get from request
    }
  }

  return (request.headers["host"] || request.hostname || "unknown").split(
    ":",
  )[0];
};

/** The hostname of a page URL, or null when it is not an absolute URL. */
export const hostnameOf = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
};

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);
const stripWww = (host: string) => host.replace(/^www\./, "");

/**
 * Does a page on `host` belong to a site registered as `domain`? The domain
 * itself, any subdomain, and local development hosts qualify; www is ignored
 * on both sides. Anything else is another site using this site's id.
 */
export const hostnameMatchesSite = (host: string, domain: string): boolean => {
  const h = stripWww(host.toLowerCase());
  const d = stripWww(domain.toLowerCase());
  if (!d) return true;
  return LOCAL.has(h) || h === d || h.endsWith(`.${d}`);
};
