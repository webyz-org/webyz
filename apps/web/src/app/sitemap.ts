import type { MetadataRoute } from "next";

import { SITE_URL } from "../config/site";
import { GUIDES } from "../lib/docs";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages = ["", "/pricing", "/docs", "/changelog", "/privacy", "/terms", "/refunds", ...GUIDES.map((g) => `/docs/${g.slug}`)];
  return pages.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: path === "" || path === "/changelog" ? "weekly" : "monthly",
    priority: path === "" ? 1 : path === "/pricing" ? 0.9 : 0.6,
  }));
}
