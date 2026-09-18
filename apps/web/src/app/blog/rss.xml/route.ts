import { SITE_URL } from "../../../config/site";
import { getPosts, toRfc822 } from "../../../lib/blog";

/**
 * The blog as a feed, at /blog/rss.xml. Prerendered with the rest of the site:
 * the posts are Markdown read at build time, and nothing here reads a request.
 */
export const dynamic = "force-static";

const escape = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export async function GET(): Promise<Response> {
  const posts = await getPosts();
  const self = `${SITE_URL}/blog/rss.xml`;

  const items = posts.map((post) => {
    const url = `${SITE_URL}/blog/${post.slug}`;
    return [
      "    <item>",
      `      <title>${escape(post.title)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      `      <pubDate>${toRfc822(post.date)}</pubDate>`,
      // The blurb, not the article. A reader that wants the piece follows the
      // link, and the link is the thing search engines and analytics can see.
      `      <description>${escape(post.description)}</description>`,
      ...post.tags.map((tag) => `      <category>${escape(tag)}</category>`),
      "    </item>",
    ].join("\n");
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    "    <title>The Webyz blog</title>",
    `    <link>${SITE_URL}/blog</link>`,
    "    <description>How privacy-first analytics actually works: what we measure, how we measure it, and what each decision costs.</description>",
    "    <language>en</language>",
    `    <atom:link href="${self}" rel="self" type="application/rss+xml" />`,
    posts[0] ? `    <lastBuildDate>${toRfc822(posts[0].updated ?? posts[0].date)}</lastBuildDate>` : "",
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
