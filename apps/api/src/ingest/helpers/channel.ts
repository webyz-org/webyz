/**
 * Acquisition channel classification, modelled on the GA4/Plausible channel
 * grouping. Runs once at session creation and is stored on the session row so
 * dashboard queries never have to re-derive it.
 */

import { AI_ASSISTANT_CHANNEL, isAiAssistant } from "./ai-assistants.js";

const SEARCH_ENGINES = new Set([
  "google",
  "bing",
  "yahoo",
  "duckduckgo",
  "baidu",
  "yandex",
  "ecosia",
  "brave",
  "startpage",
  "qwant",
  "naver",
  "ask",
  "aol",
]);

const SOCIAL_NETWORKS = new Set([
  "facebook",
  "instagram",
  "twitter",
  "x",
  "t.co",
  "linkedin",
  "pinterest",
  "reddit",
  "tiktok",
  "youtube",
  "snapchat",
  "whatsapp",
  "telegram",
  "threads",
  "mastodon",
  "bluesky",
  "tumblr",
  "vk",
  "quora",
  "discord",
  "slack",
  "medium",
  "substack",
  "news.ycombinator.com",
  "hackernews",
]);

const PAID_SEARCH_MEDIUMS = new Set(["cpc", "ppc", "paidsearch", "paid-search"]);
const PAID_SOCIAL_MEDIUMS = new Set([
  "paidsocial",
  "paid-social",
  "social-paid",
  "cpp",
]);
const DISPLAY_MEDIUMS = new Set([
  "display",
  "banner",
  "cpm",
  "expandable",
  "interstitial",
]);
const ORGANIC_SOCIAL_MEDIUMS = new Set([
  "social",
  "social-network",
  "social-media",
  "sm",
  "social network",
  "social media",
]);
const EMAIL_MEDIUMS = new Set(["email", "e-mail", "e_mail", "newsletter"]);
const AFFILIATE_MEDIUMS = new Set(["affiliate", "affiliates"]);
const REFERRAL_MEDIUMS = new Set(["referral", "refer", "link"]);

/** Strip www. and lower-case for matching. */
const normalizeDomain = (domain: string) =>
  domain.toLowerCase().replace(/^www\./, "");

/** Second-level labels under which a country code sits, as in google.co.uk. */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ne", "or", "go"]);

/**
 * The names a host is matched by: the host itself and every parent domain
 * ("lm.facebook.com", "facebook.com"), plus the site's own name for the
 * registrable domain ("facebook" for facebook.com, "google" for
 * google.co.uk). Matching only the first label used to file Facebook's and
 * Instagram's link redirects (lm.facebook.com, l.instagram.com) and
 * images.google.com as Referral. The site name is only taken from the
 * registrable domain, so a host like x.example.com never reads as X.
 */
const domainNames = (domain: string): string[] => {
  const labels = normalizeDomain(domain).split(".").filter(Boolean);
  const names: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) {
    const suffix = labels.slice(i);
    names.push(suffix.join("."));
    const registrable =
      suffix.length === 2 || (suffix.length === 3 && SECOND_LEVEL.has(suffix[1]) && suffix[2].length === 2);
    if (registrable) names.push(suffix[0]);
  }
  // A bare name with no dot, as a utm_source often is ("google", "facebook").
  if (labels.length === 1) names.push(labels[0]);
  return names;
};

const isSearchEngine = (domain: string) =>
  domainNames(domain).some((name) => SEARCH_ENGINES.has(name));

const isSocialNetwork = (domain: string) =>
  domainNames(domain).some((name) => SOCIAL_NETWORKS.has(name));

export type ChannelInput = {
  utmMedium?: string;
  utmSource?: string;
  referrerDomain?: string;
};

export const classifyChannel = ({
  utmMedium,
  utmSource,
  referrerDomain,
}: ChannelInput): string => {
  const medium = (utmMedium ?? "").trim().toLowerCase();
  const source = (utmSource ?? "").trim().toLowerCase();
  const referrer = (referrerDomain ?? "").trim();

  // Paid intent is declared by the medium, so it wins over the referrer.
  if (PAID_SEARCH_MEDIUMS.has(medium)) return "Paid Search";
  if (PAID_SOCIAL_MEDIUMS.has(medium)) return "Paid Social";
  if (DISPLAY_MEDIUMS.has(medium)) return "Display";
  if (EMAIL_MEDIUMS.has(medium)) return "Email";
  if (AFFILIATE_MEDIUMS.has(medium)) return "Affiliates";

  if (ORGANIC_SOCIAL_MEDIUMS.has(medium)) return "Organic Social";

  // A utm_source naming a known assistant, network or engine, with a
  // non-paid medium. Assistants first: ChatGPT tags its own links.
  if (source) {
    if (isAiAssistant(source)) return AI_ASSISTANT_CHANNEL;
    if (SOCIAL_NETWORKS.has(source) || isSocialNetwork(source))
      return "Organic Social";
    if (SEARCH_ENGINES.has(source) || isSearchEngine(source))
      return "Organic Search";
  }

  if (referrer && isAiAssistant(referrer)) return AI_ASSISTANT_CHANNEL;

  if (REFERRAL_MEDIUMS.has(medium) && referrer) return "Referral";

  if (referrer) {
    if (isSearchEngine(referrer)) return "Organic Search";
    if (isSocialNetwork(referrer)) return "Organic Social";
    return "Referral";
  }

  // Any leftover utm tagging without a referrer still counts as a campaign.
  if (medium || source) return "Other Campaign";

  return "Direct";
};
