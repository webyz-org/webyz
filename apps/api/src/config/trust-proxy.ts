/**
 * Which upstream proxies may set the client address.
 *
 * Fastify resolves `request.ip` from X-Forwarded-For according to
 * `trustProxy`, and everything downstream (the rate limiter's key, session IP
 * records, the geo lookup, the visitor hash) reads `request.ip` only. So this
 * one setting decides whether a client can forge its address: with
 * `trustProxy: true` the leftmost forwarded value is believed, which anyone
 * can set, and that is how it used to be configured.
 *
 * TRUST_PROXY accepts, in order of preference:
 *   - a hop count, e.g. "1" when exactly one load balancer or reverse proxy
 *     sits in front of the API. The address is taken from the right of the
 *     chain, past that many trusted hops, so nothing a client appends counts;
 *   - one or more addresses or CIDR ranges, comma separated, e.g.
 *     "10.0.0.0/8,172.16.0.0/12" or "loopback", when the proxy's address is
 *     known. Only hops from those addresses are trusted;
 *   - "false" when clients connect directly with no proxy at all;
 *   - "true" to trust every hop. Allowed for compatibility, never advisable.
 *
 * Unset means "false" in development. In production there is no safe default
 * (false throttles every user together behind a proxy; true is spoofable), so
 * the server refuses to start until it is set.
 */
export type TrustProxySetting = boolean | number | string;

export class TrustProxyError extends Error {}

export const parseTrustProxy = (raw: string | undefined, isProduction: boolean): TrustProxySetting => {
  const value = raw?.trim();

  if (!value) {
    if (isProduction) {
      throw new TrustProxyError(
        "TRUST_PROXY is not set. Set it to the number of reverse proxies in front of the API " +
          '(usually "1"), to their addresses or CIDR ranges, or to "false" if clients connect directly.',
      );
    }
    return false;
  }

  if (value === "false") return false;
  if (value === "true") return true;

  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops < 1) throw new TrustProxyError('TRUST_PROXY hop count must be at least 1, or use "false".');
    return hops;
  }

  // Addresses, CIDRs, or proxy-addr's named ranges (loopback, linklocal, uniquelocal).
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
  const valid = /^(loopback|linklocal|uniquelocal|[0-9a-fA-F.:]+(\/\d{1,3})?)$/;
  const bad = parts.filter((p) => !valid.test(p));
  if (parts.length === 0 || bad.length) {
    throw new TrustProxyError(`TRUST_PROXY has unrecognised entries: ${bad.join(", ") || value}`);
  }
  return parts.join(",");
};
