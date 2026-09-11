import { readList } from "./list-files.js";

/**
 * Referrer spam: requests fabricated so that a domain shows up in the
 * dashboard's sources, in the hope the owner visits it. The requests run no
 * script, so they only reach us through the pixel or a replayed payload, but
 * a single one pollutes a Sources card. Plausible and Matomo both drop them
 * against the community list Matomo maintains; the same list is the default
 * source here (`REFERRER_SPAM_LISTS`, refreshed by `update-bot-lists`).
 *
 * A referrer matches when it is a listed domain or a subdomain of one.
 */
let loaded: Set<string> | null = null;
let nextAttemptAt = 0;
const RETRY_MS = 60_000;

export const parseDomainList = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim().toLowerCase().replace(/^www\./, "");
    if (line && line.includes(".")) out.add(line);
  }
  return out;
};

/** Pure form: the domain or any parent domain is listed. */
export const domainListed = (list: Set<string>, domain: string): boolean => {
  const parts = domain.toLowerCase().replace(/^www\./, "").split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (list.has(parts.slice(i).join("."))) return true;
  }
  return false;
};

export const loadReferrerSpamList = async (reload = false): Promise<Set<string> | null> => {
  if (!reload) {
    if (loaded) return loaded;
    if (Date.now() < nextAttemptAt) return null;
  }
  nextAttemptAt = Date.now() + RETRY_MS;
  const list = await readList("referrerSpam");
  if (!list) return loaded;
  loaded = parseDomainList(list.text);
  console.log(`🛡️  Referrer spam list loaded (${loaded.size} domains, ${list.source})`);
  return loaded;
};

export const isSpamReferrer = async (referrerDomain: string): Promise<boolean> => {
  if (!referrerDomain) return false;
  const list = await loadReferrerSpamList();
  return list ? domainListed(list, referrerDomain) : false;
};
