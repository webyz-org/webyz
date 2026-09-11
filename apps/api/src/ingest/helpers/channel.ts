/**
 * Acquisition channel classification, modelled on the GA4/Plausible channel
 * grouping. Runs once at session creation and is stored on the session row so
 * dashboard queries never have to re-derive it.
 */

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

/** Strip www. and take the registrable-ish label for matching. */
const normalizeDomain = (domain: string) =>
  domain.toLowerCase().replace(/^www\./, "");

/** First label of the domain, e.g. "google.co.uk" -> "google". */
const domainRoot = (domain: string) => normalizeDomain(domain).split(".")[0];

const isSearchEngine = (domain: string) =>
  SEARCH_ENGINES.has(domainRoot(domain));

const isSocialNetwork = (domain: string) =>
  SOCIAL_NETWORKS.has(normalizeDomain(domain)) ||
  SOCIAL_NETWORKS.has(domainRoot(domain));

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

  // A utm_source naming a known network or engine, with a non-paid medium.
  if (source) {
    if (SOCIAL_NETWORKS.has(source) || isSocialNetwork(source))
      return "Organic Social";
    if (SEARCH_ENGINES.has(source) || isSearchEngine(source))
      return "Organic Search";
  }

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
