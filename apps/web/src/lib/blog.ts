import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  optionalList,
  optionalString,
  parseFrontmatter,
  requireDate,
  requireString,
} from "./frontmatter";

/**
 * The blog is Markdown in apps/web/content/blog, one file per post, the file
 * name being the URL slug. There is no admin panel and no database: a post is
 * a pull request, reviewed like any other change, and the site rebuilds.
 *
 * Every page that reads these files is prerendered, so the Markdown is read at
 * build time and never at request time. That matters for the Docker image: the
 * standalone server it ships does not carry content/, only the HTML built from
 * it. Anything here that starts reading at request time has to change that
 * (apps/web/Dockerfile) or it will 500 in production and work locally.
 */

export type Post = {
  slug: string;
  title: string;
  /**
   * The <title> tag, when the headline is too long to be one. A search result
   * cuts the title near 60 characters, and a page's H1 often wants to be
   * longer than that; set this to keep both right. Used verbatim, so it
   * carries its own branding if it wants any.
   */
  seoTitle?: string;
  /** The meta description and the card blurb. One sentence, under ~160 characters. */
  description: string;
  /** ISO, YYYY-MM-DD. */
  date: string;
  /** ISO, set only when a published post is revised in a way a reader would care about. */
  updated?: string;
  author: string;
  /** Lowercase, hyphenated, for related posts and the card labels. */
  tags: string[];
  /** A file in public/, with its alt text. Optional; there is no stock imagery. */
  cover?: string;
  coverAlt?: string;
  /** Minutes, from the word count. */
  readingMinutes: number;
  markdown: string;
};

/**
 * content/ sits beside src/. Next runs the build from apps/web, but tooling
 * (turbo at the repo root, an editor task) may run it from elsewhere, so the
 * same two-candidate resolution the docs use applies here.
 */
const contentDirs = () => [
  path.resolve(process.cwd(), "content/blog"),
  path.resolve(process.cwd(), "apps/web/content/blog"),
];

const readDir = async (): Promise<{ dir: string; files: string[] }> => {
  let lastError: unknown;
  for (const dir of contentDirs()) {
    try {
      // A leading underscore is the draft convention: _next-post.md sits in
      // the folder, in the repository, and is not published until it is
      // renamed. A README is a note to contributors, not a post.
      const files = (await readdir(dir)).filter(
        (name) => name.endsWith(".md") && !name.startsWith("_") && name !== "README.md",
      );
      return { dir, files };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
};

/** 200 words a minute, rounded up, never less than one. Code blocks are read slower, but not by enough to model. */
const readingMinutes = (markdown: string): number =>
  Math.max(1, Math.round(markdown.trim().split(/\s+/).length / 200));

/**
 * A post file opens with its title as an H1, so it reads correctly on GitHub
 * and in an editor. The page renders the title from the frontmatter instead,
 * with the date and the byline, so that H1 is removed here: two of them on one
 * page is a real accessibility and search problem, and the two could drift.
 */
const stripLeadingH1 = (markdown: string): string =>
  markdown.replace(/^\s*#\s+.*(?:\r?\n)+/, "");

const toPost = (file: string, source: string): Post => {
  const { data, body: raw } = parseFrontmatter(source, file);
  const body = stripLeadingH1(raw);
  const slug = file.replace(/\.md$/, "");

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`${file}: the file name is the URL, so it must be lowercase words joined by hyphens.`);
  }

  const cover = optionalString(data, "cover", file);
  const coverAlt = optionalString(data, "coverAlt", file);
  if (cover && !coverAlt) throw new Error(`${file}: a cover needs "coverAlt". An unlabelled image is unreadable to some readers.`);

  const description = requireString(data, "description", file);
  if (description.length > 200) throw new Error(`${file}: "description" is ${description.length} characters; search results cut it near 160.`);

  return {
    slug,
    title: requireString(data, "title", file),
    seoTitle: optionalString(data, "seoTitle", file),
    description,
    date: requireDate(data, "date", file),
    updated: data.updated === undefined ? undefined : requireDate(data, "updated", file),
    author: requireString(data, "author", file),
    tags: optionalList(data, "tags", file).map((tag) => tag.toLowerCase()),
    cover,
    coverAlt,
    readingMinutes: readingMinutes(body),
    markdown: body,
  };
};

let cache: Post[] | null = null;

/**
 * Every post, newest first.
 *
 * Read once per build in production, where the files cannot change under a
 * running server. In development the cache is skipped: the module outlives a
 * request, so caching there means an edit to a post does not show until the
 * dev server is restarted, and a writer should see a save by refreshing.
 */
export const getPosts = async (): Promise<Post[]> => {
  if (cache && process.env.NODE_ENV === "production") return cache;

  const { dir, files } = await readDir();
  const posts = await Promise.all(
    files.map(async (file) => toPost(file, await readFile(path.join(dir, file), "utf8"))),
  );

  const slugs = new Set<string>();
  for (const post of posts) {
    if (slugs.has(post.slug)) throw new Error(`Two posts claim the slug "${post.slug}".`);
    slugs.add(post.slug);
  }

  // Newest first, and a same-day tie broken by title so the order never depends
  // on the order the filesystem happened to list the directory in.
  cache = posts.sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : b.date < a.date ? -1 : 1));
  return cache;
};

export const getPost = async (slug: string): Promise<Post | undefined> =>
  (await getPosts()).find((post) => post.slug === slug);

/**
 * Posts to read next: the most tags in common first, then the newest. Falls
 * back to the newest other posts, so the block is never empty on a post that
 * happens to share no tag with anything.
 */
export const relatedPosts = async (post: Post, limit = 3): Promise<Post[]> => {
  const others = (await getPosts()).filter((other) => other.slug !== post.slug);
  const shared = (other: Post) => other.tags.filter((tag) => post.tags.includes(tag)).length;
  return [...others].sort((a, b) => shared(b) - shared(a)).slice(0, limit);
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "17 September 2026", formatted here so the server and the feed agree on the string. */
export const formatPostDate = (iso: string): string => {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
};

/** RFC 822, which is what an RSS pubDate must be. Posts are dated, not timed. */
export const toRfc822 = (iso: string): string => new Date(`${iso}T09:00:00Z`).toUTCString();

/** The label on a card: "17 September 2026 - 6 min read". */
export const postMeta = (post: Post): string =>
  `${formatPostDate(post.date)} - ${post.readingMinutes} min read`;
