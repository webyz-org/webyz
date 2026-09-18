import { SITE_URL } from "../../../config/site";
import { KIND_LABEL, RELEASES, formatReleaseDate, sortItems, toRfc822 } from "../../../lib/changelog";

/**
 * The changelog as a feed, at /changelog/rss.xml. The entries are a constant
 * in the bundle, so this is prerendered with the rest of the site and served
 * as a file; nothing here reads a request.
 */
export const dynamic = "force-static";

const escape = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function GET(): Response {
  const self = `${SITE_URL}/changelog/rss.xml`;

  const items = RELEASES.map((release) => {
    const url = `${SITE_URL}/changelog#${release.slug}`;
    // The body is escaped HTML in <description>, which every reader renders,
    // rather than a second content:encoded element saying the same thing.
    const body = [
      release.summary ? `<p>${escape(release.summary)}</p>` : "",
      "<ul>",
      ...sortItems(release.items).map(
        (item) => `<li><strong>${KIND_LABEL[item.kind]}:</strong> ${escape(item.text)}</li>`,
      ),
      "</ul>",
    ].join("");

    return [
      "    <item>",
      `      <title>${escape(`${formatReleaseDate(release.date)} - ${release.title}`)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      `      <pubDate>${toRfc822(release.date)}</pubDate>`,
      `      <description>${escape(body)}</description>`,
      "    </item>",
    ].join("\n");
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    "    <title>Webyz changelog</title>",
    `    <link>${SITE_URL}/changelog</link>`,
    "    <description>Every release to Webyz: what was added, what changed and what was fixed.</description>",
    "    <language>en</language>",
    `    <atom:link href="${self}" rel="self" type="application/rss+xml" />`,
    RELEASES[0] ? `    <lastBuildDate>${toRfc822(RELEASES[0].date)}</lastBuildDate>` : "",
    ...items,
    "  </channel>",
    "</rss>",
  ]
    .filter(Boolean)
    .join("\n");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
