/**
 * Paddle's webhook source addresses, fetched from Paddle rather than written
 * down, because the list changes and a stale copy would drop real deliveries.
 *
 * This is defence in depth, not the gate. The gate is the signature: a body
 * from anywhere fails HMAC verification. What the allowlist adds is that a
 * forged or flooded request from elsewhere is refused before any work, and
 * the log tells the two apart. So when the list cannot be fetched the verdict
 * is "unknown" and the signature check runs alone, never "no".
 */

const REFRESH_MS = 60 * 60 * 1000;

type Cache = { cidrs: string[]; fetchedAt: number };
let cache: Cache | null = null;
let inflight: Promise<void> | null = null;

export const paddleIpsUrl = (environment: "sandbox" | "production") =>
  environment === "sandbox" ? "https://sandbox-api.paddle.com/ips" : "https://api.paddle.com/ips";

const ipv4ToInt = (ip: string): number | null => {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
};

/**
 * Whether an address falls inside any of the CIDRs. IPv4 only, which is what
 * Paddle publishes; an IPv4-mapped IPv6 form (::ffff:1.2.3.4) is unwrapped
 * because that is how Node reports IPv4 clients on a dual-stack socket.
 */
export const ipMatchesCidrs = (ip: string, cidrs: readonly string[]): boolean => {
  const bare = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const addr = ipv4ToInt(bare);
  if (addr === null) return false;
  for (const cidr of cidrs) {
    const [base, bitsRaw] = cidr.split("/");
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) continue;
    const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    if (bits === 0) return true;
    const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
    if (((addr & mask) >>> 0) === ((baseInt & mask) >>> 0)) return true;
  }
  return false;
};

/** Fetch the current list. Throws on any failure; callers decide what that means. */
export const fetchPaddleIps = async (environment: "sandbox" | "production", fetchImpl: typeof fetch = fetch): Promise<string[]> => {
  const res = await fetchImpl(paddleIpsUrl(environment), { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`GET ${paddleIpsUrl(environment)} answered ${res.status}`);
  const body = (await res.json()) as { data?: { ipv4_cidrs?: unknown } };
  const cidrs = body.data?.ipv4_cidrs;
  if (!Array.isArray(cidrs) || cidrs.length === 0 || !cidrs.every((c) => typeof c === "string")) {
    throw new Error("Paddle /ips answered without an ipv4_cidrs list");
  }
  return cidrs;
};

const refresh = async (environment: "sandbox" | "production") => {
  if (inflight) return inflight;
  inflight = fetchPaddleIps(environment)
    .then((cidrs) => {
      cache = { cidrs, fetchedAt: Date.now() };
    })
    .catch((err) => {
      console.warn(`[paddle-ips] could not refresh the allowlist: ${err instanceof Error ? err.message : err}`);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
};

/**
 * Is this the address of a Paddle webhook sender? "unknown" when the list has
 * never been fetched successfully; a stale list is still used, and refreshed
 * in the background, because Paddle's addresses change rarely and a refresh
 * that fails must not stop deliveries.
 */
export const isKnownPaddleIp = async (ip: string, environment: "sandbox" | "production"): Promise<"yes" | "no" | "unknown"> => {
  if (!cache) await refresh(environment);
  else if (Date.now() - cache.fetchedAt > REFRESH_MS) void refresh(environment);
  if (!cache) return "unknown";
  return ipMatchesCidrs(ip, cache.cidrs) ? "yes" : "no";
};

/** Test seam. */
export const resetPaddleIpCache = () => {
  cache = null;
  inflight = null;
};
