import { readList } from "./list-files.js";

/**
 * Data-centre address filter, the second ingest bot filter.
 *
 * The scripted traffic that inflates a dashboard today is a headless browser
 * on a rented server sending a real browser's user agent: it runs the
 * tracker, so the user-agent filter and the client-side checks both let it
 * through. What it cannot fake is where it connects from. Plausible drops
 * these by classifying the address at its edge; Simple Analytics matches
 * against provider ranges. This is the same idea: the client address is
 * checked, in memory, against a list of cloud, hosting and VPN ranges, and a
 * hit is dropped before anything is written. The address is discarded
 * afterwards exactly as it is for the geo lookup and the daily hash.
 *
 * The list lives at geo/datacenter-ips.txt (the same volume as the MaxMind
 * database; see list-files.ts for the image seed fallback), one address or
 * CIDR per line, IPv4 and IPv6 mixed, `#` comments allowed.
 * `list-updater.service.ts` refreshes it daily from `DATACENTER_IP_LISTS`.
 * Without a file nothing is dropped: the filter fails open like every other
 * optional dependency at ingest.
 *
 * The list of ranges is a sorted, merged set of intervals per address family
 * and a lookup is a binary search, so 40,000 ranges cost nothing per event.
 *
 * Known trade-off: a visitor on a commercial VPN exits from such a range and
 * is dropped too. Plausible and Simple Analytics accept the same; the
 * operator can turn the filter off with `BOT_DATACENTER_FILTER=off`.
 *
 * One privacy relay is not a trade-off but a bug, so it is carved out: iCloud
 * Private Relay routes ordinary iPhone Safari users through Akamai and
 * Cloudflare egress ranges, and a third of its IPv4 blocks (most of the IPv6
 * ones) fall inside the hosting lists. Apple publishes the egress ranges, so
 * geo/datacenter-ips-allow.txt (from `DATACENTER_IP_ALLOWLISTS`) is checked
 * first and an address in it is never dropped. Measured 11 Sep 2026: 14,216
 * of 41,981 relay IPv4 blocks and 3,178 of 5,449 Indian blocks were in the
 * deny list.
 */

export type RangeSet = {
  v4Start: Uint32Array;
  v4End: Uint32Array;
  v6Start: bigint[];
  v6End: bigint[];
  /** Ranges kept after merging, for logs and the updater's sanity check. */
  size: number;
};

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Dotted quad to an unsigned 32-bit number, or null when malformed. */
export const parseIPv4 = (s: string): number | null => {
  const m = V4.exec(s);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const octet = Number(m[i]);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n;
};

/** RFC 4291 text to a 128-bit BigInt, or null when malformed. */
export const parseIPv6 = (s: string): bigint | null => {
  let text = s;
  // An IPv4-mapped or -embedded tail ("::ffff:1.2.3.4") becomes two groups.
  const lastColon = text.lastIndexOf(":");
  if (lastColon !== -1 && text.includes(".", lastColon)) {
    const v4 = parseIPv4(text.slice(lastColon + 1));
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;

  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
};

/**
 * Parses list text into a range set. Lines that are not an address or a CIDR
 * are ignored rather than fatal, so one bad line in an upstream list cannot
 * switch the filter off.
 */
export const parseRangeList = (text: string): RangeSet => {
  const v4: [number, number][] = [];
  const v6: [bigint, bigint][] = [];

  for (const raw of text.split(/\r?\n/)) {
    // First field only, so a CSV such as Apple's egress list (cidr,country,
    // region,city) works unchanged.
    const line = raw.replace(/#.*$/, "").split(/[,\s]/)[0].trim();
    if (!line) continue;
    const [addr, prefixText] = line.split("/");

    if (addr.includes(":")) {
      const base = parseIPv6(addr);
      const prefix = prefixText === undefined ? 128 : Number(prefixText);
      if (base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 128) continue;
      const mask = prefix === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - prefix)) - 1n);
      const start = base & mask;
      v6.push([start, start | (((1n << 128n) - 1n) ^ mask)]);
    } else {
      const base = parseIPv4(addr);
      const prefix = prefixText === undefined ? 32 : Number(prefixText);
      if (base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) continue;
      const size = 2 ** (32 - prefix);
      const start = Math.floor(base / size) * size;
      v4.push([start, start + size - 1]);
    }
  }

  const merged4 = merge(v4, (a, b) => a - b, (a) => a + 1);
  const merged6 = merge(v6, (a, b) => (a < b ? -1 : a > b ? 1 : 0), (a) => a + 1n);

  return {
    v4Start: Uint32Array.from(merged4.map(([s]) => s)),
    v4End: Uint32Array.from(merged4.map(([, e]) => e)),
    v6Start: merged6.map(([s]) => s),
    v6End: merged6.map(([, e]) => e),
    size: merged4.length + merged6.length,
  };
};

/** Sorts intervals and merges the ones that overlap or touch. */
const merge = <T>(
  ranges: [T, T][],
  compare: (a: T, b: T) => number,
  next: (a: T) => T,
): [T, T][] => {
  ranges.sort((a, b) => compare(a[0], b[0]));
  const out: [T, T][] = [];
  for (const [start, end] of ranges) {
    const last = out[out.length - 1];
    if (last && compare(start, next(last[1])) <= 0) {
      if (compare(end, last[1]) > 0) last[1] = end;
    } else {
      out.push([start, end]);
    }
  }
  return out;
};

/** Index of the last range starting at or before `ip`, or -1. */
const lastStartAtOrBefore = (count: number, atOrBefore: (i: number) => boolean): number => {
  let lo = 0;
  let hi = count - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (atOrBefore(mid)) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};

/** Whether `ip` (v4, v6 or v4-mapped v6 text) falls in any range of the set. */
export const rangeSetHas = (set: RangeSet, ip: string): boolean => {
  const text = ip.trim();
  if (!text) return false;

  if (text.includes(":")) {
    const n = parseIPv6(text);
    if (n === null) return false;
    // ::ffff:a.b.c.d is an IPv4 client seen through a dual-stack socket.
    if (n >> 32n === 0xffffn) return has4(set, Number(n & 0xffffffffn));
    const i = lastStartAtOrBefore(set.v6Start.length, (k) => set.v6Start[k] <= n);
    return i !== -1 && set.v6End[i] >= n;
  }

  const n = parseIPv4(text);
  return n === null ? false : has4(set, n);
};

const has4 = (set: RangeSet, n: number): boolean => {
  const i = lastStartAtOrBefore(set.v4Start.length, (k) => set.v4Start[k] <= n);
  return i !== -1 && set.v4End[i] >= n;
};

export type Lists = { deny: RangeSet; allow: RangeSet | null };

let loaded: Lists | null = null;
let nextAttemptAt = 0;
/** How long a missing or unreadable file is remembered before another read. */
const RETRY_MS = 60_000;

/**
 * Loads both lists lazily, live copy first and the image seed as fallback
 * (list-files.ts). A missing deny list is remembered for a minute so a fresh
 * install does not stat the disk on every event; `reload` (from the updater)
 * reads at once. The allow list is optional.
 */
export const loadDatacenterList = async (reload = false): Promise<Lists | null> => {
  if (!reload) {
    if (loaded) return loaded;
    if (Date.now() < nextAttemptAt) return null;
  }
  nextAttemptAt = Date.now() + RETRY_MS;

  const deny = await readList("datacenter");
  if (!deny) return loaded;
  const allow = await readList("datacenterAllow");
  loaded = { deny: parseRangeList(deny.text), allow: allow ? parseRangeList(allow.text) : null };
  console.log(
    `🛡️  Data-centre IP list loaded (${loaded.deny.size} ranges, ${loaded.allow ? loaded.allow.size : 0} allowed, ${deny.source})`,
  );
  return loaded;
};

/** Pure form of the decision, for tests: in the deny list and not allowed. */
export const decide = (lists: Lists, ip: string): boolean =>
  rangeSetHas(lists.deny, ip) && !(lists.allow ? rangeSetHas(lists.allow, ip) : false);

/**
 * Whether the client address is in a known data-centre, hosting or VPN range
 * and not in a published privacy-relay range.
 */
export const isDatacenterIp = async (ip: string): Promise<boolean> => {
  const lists = await loadDatacenterList();
  return lists ? decide(lists, ip) : false;
};
