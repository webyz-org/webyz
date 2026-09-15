import axios from "axios";
import type { Redis } from "ioredis";

/**
 * Site icons for the dashboard's website list.
 *
 * The browser never talks to an icon service directly. A dashboard fetching
 * icons from Google or DuckDuckGo would hand that third party the signed-in
 * user's whole list of domains, which is exactly the leak this product tells
 * customers it does not make. The API fetches instead, so the upstream sees
 * one server address and a domain, never a visitor.
 *
 * Two upstreams, tried in order. DuckDuckGo's index is the better-behaved
 * service but it is not exhaustive: it has no icon for small or recently
 * launched sites (webyz.io included, checked 14 Sep 2026), and small sites
 * are most of this list. Google's is more complete, so it is the fallback
 * rather than the default.
 */
const SOURCES: ((domain: string) => string)[] = [
  (domain) => `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  (domain) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
];

/** A favicon is a few KB; anything larger is not one and is refused. */
const MAX_BYTES = 100 * 1024;
const TIMEOUT_MS = 4_000;

/** Cached long, because a site's icon changes about never. */
const HIT_TTL_SECONDS = 7 * 24 * 60 * 60;
/**
 * A miss is cached too, and for a whole day: without it every dashboard load
 * re-asks two upstreams for an icon that does not exist, once per site.
 */
const MISS_TTL_SECONDS = 24 * 60 * 60;

const key = (domain: string) => `favicon:${domain}`;
const missKey = (domain: string) => `favicon:miss:${domain}`;

export type Favicon = { body: Buffer; contentType: string };

/**
 * A hostname we are willing to put in an upstream URL: labels of letters,
 * digits and hyphens, at least one dot, no path, no port, no credentials.
 * The domain arrives from the URL, so this is the whole of the defence
 * against pointing the fetch somewhere else.
 */
const DOMAIN = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const normalizeDomain = (raw: string): string | null => {
  const domain = raw.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  return DOMAIN.test(domain) ? domain : null;
};

/** An image content type, or null for anything else (an error page, HTML). */
const imageType = (value: unknown): string | null => {
  const type = String(value ?? "").split(";")[0].trim().toLowerCase();
  return type.startsWith("image/") ? type : null;
};

const fetchFrom = async (url: string): Promise<Favicon | null> => {
  const res = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    timeout: TIMEOUT_MS,
    maxContentLength: MAX_BYTES,
    maxRedirects: 3,
    // Both services answer 404 with a placeholder image, so a status check
    // is the only way to tell "here is the icon" from "I have no icon".
    validateStatus: (status) => status === 200,
    headers: { Accept: "image/*" },
  });

  const contentType = imageType(res.headers["content-type"]);
  const body = Buffer.from(res.data);
  if (!contentType || body.length === 0) return null;
  return { body, contentType };
};

/**
 * The icon for `domain`, or null when no upstream has one.
 *
 * Redis is a cache, never the truth: a failed read or write degrades to a
 * live fetch, exactly like every other cache in this codebase. An upstream
 * that errors is a miss for this attempt only, not a cached miss, so an
 * outage at DuckDuckGo does not blank the list for a day.
 */
export const getFavicon = async (
  redis: Redis,
  domain: string,
): Promise<Favicon | null> => {
  const cached = await redis.getBuffer(key(domain)).catch(() => null);
  if (cached?.length) {
    const type = await redis.get(`${key(domain)}:type`).catch(() => null);
    return { body: cached, contentType: type ?? "image/x-icon" };
  }

  const missed = await redis.get(missKey(domain)).catch(() => null);
  if (missed) return null;

  let reachedAnUpstream = false;

  for (const source of SOURCES) {
    let icon: Favicon | null = null;
    try {
      icon = await fetchFrom(source(domain));
      reachedAnUpstream = true;
    } catch (err: any) {
      // A 404 is an answer: that service has no icon. Anything else is the
      // service failing us, and must not be recorded as "no icon exists".
      if (err?.response?.status === 404) reachedAnUpstream = true;
      continue;
    }
    if (!icon) continue;

    await redis
      .multi()
      .set(key(domain), icon.body, "EX", HIT_TTL_SECONDS)
      .set(`${key(domain)}:type`, icon.contentType, "EX", HIT_TTL_SECONDS)
      .exec()
      .catch(() => null);

    return icon;
  }

  if (reachedAnUpstream) {
    await redis.set(missKey(domain), "1", "EX", MISS_TTL_SECONDS).catch(() => null);
  }

  return null;
};
