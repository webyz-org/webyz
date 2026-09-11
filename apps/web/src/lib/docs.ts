import { readFile } from "node:fs/promises";
import path from "node:path";

import { GITHUB_URL } from "../config/site";

/**
 * The public documentation is the Markdown in the repository's docs/ folder,
 * rendered here at /docs/<slug>. One source: the files GitHub shows are the
 * files this site serves, read at build time. Order here is reading order.
 */
export const GUIDES = [
  { slug: "self-hosting", file: "self-hosting.md", title: "Self-hosting", blurb: "Requirements, configuration, Caddy or nginx, first deploy, updates and backups." },
  { slug: "configuration", file: "configuration.md", title: "Configuration", blurb: "Every environment variable for the API, the dashboard and this site." },
  { slug: "tracker", file: "tracker.md", title: "Tracker", blurb: "Installing the script, its options, custom events, single-page apps, opt-out and what is collected." },
  { slug: "api", file: "api.md", title: "HTTP API", blurb: "Authentication with API keys, every endpoint, periods and filters, CSV export, errors and rate limits." },
  { slug: "development", file: "development.md", title: "Development", blurb: "Running Webyz locally, tests, project layout and conventions." },
  { slug: "architecture", file: "architecture.md", title: "Architecture", blurb: "How an event travels from the script to the dashboard, and why the data model looks the way it does." },
] as const;

export type Guide = (typeof GUIDES)[number];

export const findGuide = (slug: string): Guide | undefined => GUIDES.find((g) => g.slug === slug);

/**
 * docs/ sits two levels above apps/web. Next runs the build from apps/web
 * (pnpm) but tooling may run it from the repo root, so try both.
 */
const docsDir = () => {
  const candidates = [path.resolve(process.cwd(), "../../docs"), path.resolve(process.cwd(), "docs")];
  return candidates;
};

export const readGuide = async (guide: Guide): Promise<string> => {
  let lastError: unknown;
  for (const dir of docsDir()) {
    try {
      return await readFile(path.join(dir, guide.file), "utf8");
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
};

/**
 * Markdown links are written for GitHub, relative to docs/. On the site:
 *  - another guide (`api.md`, `./api.md`) becomes `/docs/api`;
 *  - the privacy and terms pages become their routes;
 *  - anything else in the repo (`../CONTRIBUTING.md`, `../apps/...`) points at
 *    the file on GitHub;
 *  - absolute URLs and in-page anchors pass through.
 */
export const rewriteDocLink = (href: string): string => {
  if (/^(https?:)?\/\//.test(href) || href.startsWith("#") || href.startsWith("mailto:")) return href;

  const [pathPart, hash = ""] = href.split("#");
  const anchor = hash ? `#${hash}` : "";

  const guideMatch = /^(?:\.\/)?([a-z0-9-]+)\.md$/i.exec(pathPart);
  if (guideMatch && findGuide(guideMatch[1])) return `/docs/${guideMatch[1]}${anchor}`;

  if (pathPart.includes("apps/web/src/app/privacy")) return "/privacy";
  if (pathPart.includes("apps/web/src/app/terms")) return "/terms";

  // Repo-relative: strip leading ../ segments, the rest is a path from the root.
  const repoPath = pathPart.replace(/^(\.\.\/)+/, "");
  return `${GITHUB_URL.replace(/\/$/, "")}/blob/main/${repoPath}${anchor}`;
};

/** GitHub-style heading ids, so in-page anchors and the table of contents agree. */
export const slugifyHeading = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

/** Level-2 headings, for the "On this page" list. */
export const extractHeadings = (markdown: string): { id: string; text: string }[] =>
  markdown
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => {
      const text = line.slice(3).trim();
      return { id: slugifyHeading(text), text };
    });
