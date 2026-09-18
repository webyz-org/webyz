/**
 * The public release notes rendered at /changelog.
 *
 * Two changelogs exist on purpose, and they are not the same document.
 * CHANGELOG.md in the repository root is the operator's file: Keep a
 * Changelog, exhaustive, written for someone about to upgrade a self-hosted
 * install and scan the Breaking subsection. This file is the reader's file:
 * dated entries in plain language for people using the hosted product. It is
 * written by hand rather than parsed from that one because that file carries
 * no dates and, until the first release tag, a single "Unreleased" section.
 *
 * Shipping a release: add an entry at the top of RELEASES and the matching
 * section to CHANGELOG.md. Entries are rendered in the order written here and
 * are never sorted, so newest goes first. A slug is a permalink the moment the
 * page is deployed; change the title freely, never the slug.
 */

/** New capability, a change to something that existed, or a bug put right. */
export type ChangeKind = "new" | "improved" | "fixed";

export type ChangeItem = { kind: ChangeKind; text: string };

export type Release = {
  /** URL fragment, so one entry is linkable. Stable once published. */
  slug: string;
  /** ISO, YYYY-MM-DD. */
  date: string;
  title: string;
  /** A sentence or two under the title. Optional. */
  summary?: string;
  /** Short label beside the date, such as "Beta". Optional. */
  tag?: string;
  items: ChangeItem[];
};

export const KIND_LABEL: Record<ChangeKind, string> = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
};

/** Reading order inside an entry: what you gained, what changed, what was broken. */
const KIND_ORDER: ChangeKind[] = ["new", "improved", "fixed"];

export const sortItems = (items: readonly ChangeItem[]): ChangeItem[] =>
  [...items].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

export const RELEASES: Release[] = [
  {
    slug: "billing-counts-every-hour",
    date: "2026-09-17",
    title: "Billing counts every hour, and a trial can buy a plan",
    summary:
      "A pass over the money path. Both of these were found by reconciling what the usage ledger said against what the hourly buckets held.",
    items: [
      {
        kind: "fixed",
        text: "Usage now counts the partial hour a billing period starts in. A period is anchored to the moment the subscription began, so it almost never starts on the hour, and that first hour was discarded rather than counted: every period was short by up to an hour of traffic. Counts were low, never high, so no account was overcharged. Open periods correct themselves on the next hourly sync.",
      },
      {
        kind: "fixed",
        text: "A trial that used up its allowance can now buy a plan. It was a dead end: the billing page read an exhausted trial as an account that already pays, so the plan being trialled showed as current and could not be clicked, and every other plan opened a dialog that failed.",
      },
      {
        kind: "fixed",
        text: "Cancelling a subscription closes its usage period with a final count that includes the hour the cancellation lands in, so a closed period's total always matches its own hourly buckets. A period left open by an interrupted cancellation is swept up by the next hourly sync.",
      },
    ],
  },
  {
    slug: "site-favicons",
    date: "2026-09-15",
    title: "Every site wears its own favicon",
    items: [
      {
        kind: "new",
        text: "The website list and the site switcher show each site's real favicon, falling back to the coloured initial tile when a site has none.",
      },
      {
        kind: "improved",
        text: "The icon is fetched and cached by the Webyz API, never by your browser. Loading icons directly from a third-party service would hand it the full list of domains you are signed in to.",
      },
    ],
  },
  {
    slug: "bot-filtering-and-engagement",
    date: "2026-09-12",
    title: "Four bot filters, and engagement that counts",
    summary:
      "Scripted traffic was a third of the first live site's busiest hour. Four filters now sit in front of ingest, cheapest first, and every drop is counted so you can see what they caught.",
    items: [
      {
        kind: "new",
        text: "Engagement tracking: the script reports how long a page was visible and how far it was scrolled when the tab is hidden, loses focus or is left. Visit duration runs to the last report, so a single-page visit is no longer 0 s. Engagement reports are never billed as events.",
      },
      {
        kind: "new",
        text: "Filtered traffic on the overview: the total the filters refused for the period, with the split by reason on hover.",
      },
      {
        kind: "new",
        text: "Four ingest filters: a crawler and headless-browser database, known data-centre and VPN address ranges with Apple's iCloud Private Relay egress carved out, the Matomo referrer-spam list, and a behavioural filter that flags groups of identical single-page visits with no engagement from any of them.",
      },
      {
        kind: "improved",
        text: "Bounce rate and visit duration now match Plausible and Umami: a custom event counts as engagement, so it ends the bounce and extends the visit.",
      },
      {
        kind: "fixed",
        text: "The behavioural filter judges a group only on pageviews that carry a screen size and a language, so visits recorded before those were stored can no longer trip it.",
      },
    ],
  },
  {
    slug: "open-source",
    date: "2026-09-11",
    title: "Webyz is open source",
    summary:
      "The whole product is on GitHub under AGPL-3.0: the API, the dashboard, the tracker and the infrastructure that runs the hosted service. What you self-host is what we run.",
    items: [
      {
        kind: "new",
        text: "One-command self-hosting: infra/setup.sh, then docker compose up -d. Caddy and a Let's Encrypt certificate come with it, and prebuilt images are published for amd64 and arm64.",
      },
      {
        kind: "new",
        text: "Six documentation guides at /docs, rendered from the Markdown that sits next to the code it describes: self-hosting, configuration, the tracker, the HTTP API, development and architecture.",
      },
      {
        kind: "new",
        text: "Logos for the in-app and OEM browsers that were showing a placeholder, among them Facebook, Instagram, X, TikTok, WeChat, the Google app, Vivo, HeyTap, MIUI, Huawei, UC, Yandex, Vivaldi, DuckDuckGo and Ecosia, plus the operating systems that were missing one.",
      },
      {
        kind: "fixed",
        text: "A long page URL no longer overflows its row in the Pages card.",
      },
    ],
  },
  {
    slug: "hosted-beta",
    date: "2026-09-09",
    tag: "Beta",
    title: "The hosted beta opens",
    summary: "webyz.io is live. Sign up, add a site, paste one script tag before the closing body tag.",
    items: [
      {
        kind: "new",
        text: "The dashboard: traffic over time in your site's own timezone, sources, pages, entry and exit pages, devices, geography, realtime, goals and funnels, journeys, and drill-down filters on every card.",
      },
      {
        kind: "new",
        text: "A tracker under 4 KB gzipped that sets no cookie and writes nothing to the browser. Visitors are identified by a server-side hash that rotates daily, and the IP address is used for the country lookup and then dropped.",
      },
      {
        kind: "new",
        text: "Every new account gets a 30 day trial of Growth and then the free plan. A trial ending never deletes anything.",
      },
      {
        kind: "new",
        text: "Shareable dashboards with an optional password, an embed mode for iframes, weekly and monthly email reports, traffic spike alerts, CSV export and read-only API keys.",
      },
    ],
  },
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "17 September 2026". Formatted here rather than with Intl so the string is
 * the same whoever renders it: the page is prerendered on the server and the
 * feed is built from the same function.
 */
export const formatReleaseDate = (iso: string): string => {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
};

/** RFC 822, which is what an RSS pubDate must be. Releases are dated, not timed. */
export const toRfc822 = (iso: string): string => new Date(`${iso}T09:00:00Z`).toUTCString();

export const LATEST_RELEASE_DATE = RELEASES[0]?.date ?? null;
