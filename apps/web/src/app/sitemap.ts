import type { MetadataRoute } from "next";

import { SITE_URL } from "../config/site";
import { getPosts } from "../lib/blog";
import { GUIDES } from "../lib/docs";

/**
 * A blog post carries the date it was written or revised, which is the only
 * honest lastModified we have; everything else is stamped with the build,
 * because that is when its content could last have changed.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const posts = await getPosts();

  const pages = [
    "",
    "/pricing",
    "/docs",
    "/blog",
    "/changelog",
    "/privacy",
    "/terms",
    "/refunds",
    ...GUIDES.map((g) => `/docs/${g.slug}`),
  ];

  const priority = (path: string) =>
    path === "" ? 1 : path === "/pricing" ? 0.9 : path === "/blog" ? 0.8 : 0.6;

  // The landing page, the blog index and the changelog gain entries; the rest
  // change only when someone edits them.
  const frequency = (path: string): "weekly" | "monthly" =>
    path === "" || path === "/changelog" || path === "/blog" ? "weekly" : "monthly";

  return [
    ...pages.map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified: now,
      changeFrequency: frequency(path),
      priority: priority(path),
    })),
    ...posts.map((post) => ({
      url: `${SITE_URL}/blog/${post.slug}`,
      lastModified: new Date(`${post.updated ?? post.date}T09:00:00Z`),
      changeFrequency: "yearly" as const,
      priority: 0.7,
    })),
  ];
}
