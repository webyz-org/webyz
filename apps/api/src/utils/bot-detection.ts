import { isBot as uaParserIsBot } from "ua-parser-js/helpers";

/**
 * User-agent bot detection, the first of the two ingest filters (the second,
 * `core/bots/datacenter-ips.ts`, looks at the address).
 *
 * `ua-parser-js` ships a maintained database of crawlers, fetchers (link
 * previewers such as facebookexternalhit and WhatsApp), CLIs and HTTP
 * libraries, so a named bot is recognised by what it is rather than by a
 * word in its string. That replaced a hand-written list of fourteen regexes
 * which matched vendor names: `/facebook/`, `/google/`, `/duckduckgo/` and
 * `/yandex/` caught those vendors' crawlers, but also dropped anyone using
 * the DuckDuckGo browser, whose user agent carries the vendor's name.
 *
 * Two generic checks remain on top of the database. A user agent that calls
 * itself a bot, crawler or spider is one even when nobody has catalogued it
 * yet, and a headless Chrome that has not bothered to hide the fact says so
 * in its string. Neither matches a browser people use.
 *
 * Automation that sends a real browser's user agent from a rented server is
 * invisible here by design; that is what the data-centre filter is for.
 */
// "bot" is matched as a suffix ("Googlebot/", "ThingBot;") because that is
// how bots name themselves; the other words as whole words.
const GENERIC_BOT = /bot\b|\b(crawler|spider|crawling)\b|headlesschrome/i;

export const isBot = (userAgent: string): boolean => {
  if (!userAgent) return false;
  if (GENERIC_BOT.test(userAgent)) return true;
  return uaParserIsBot(userAgent);
};
