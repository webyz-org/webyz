/**
 * The smallest frontmatter reader that covers what a blog post needs, written
 * here rather than pulled in as a YAML dependency.
 *
 * The supported grammar is deliberately tiny, because we write every file it
 * parses: a `---` fenced block of `key: value` lines at the very top, where a
 * value is a scalar or a `[one, two]` list, optionally quoted. Anything else
 * (nesting, block scalars, anchors, a stray tab) throws, and because every
 * caller runs at build time a bad post fails `next build` instead of shipping
 * as a blank page.
 */

export type FrontmatterValue = string | string[];
export type Frontmatter = Record<string, FrontmatterValue>;

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Strips one layer of matching quotes, and nothing else. */
const unquote = (raw: string): string => {
  const value = raw.trim();
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  return quoted && value.length >= 2 ? value.slice(1, -1) : value;
};

export function parseFrontmatter(source: string, file: string): { data: Frontmatter; body: string } {
  const match = FENCE.exec(source);
  if (!match) throw new Error(`${file}: no frontmatter. A post starts with a --- fenced block.`);

  const data: Frontmatter = {};
  for (const [index, line] of match[1].split(/\r?\n/).entries()) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const where = `${file}, frontmatter line ${index + 1}`;

    if (/^\s/.test(line)) throw new Error(`${where}: indented lines are not supported, keep every key at the margin.`);

    const colon = line.indexOf(":");
    if (colon === -1) throw new Error(`${where}: expected "key: value".`);

    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) throw new Error(`${where}: "${key}" is not a usable key.`);
    if (key in data) throw new Error(`${where}: "${key}" is set twice.`);
    if (rest === "") throw new Error(`${where}: "${key}" has no value. Remove the key instead of leaving it empty.`);

    data[key] = rest.startsWith("[")
      ? (() => {
          if (!rest.endsWith("]")) throw new Error(`${where}: a list must open and close on one line.`);
          const inner = rest.slice(1, -1).trim();
          return inner === "" ? [] : inner.split(",").map(unquote).filter((item) => item !== "");
        })()
      : unquote(rest);
  }

  return { data, body: source.slice(match[0].length) };
}

/** Reads a required scalar, with the file named in the error so the build says what to fix. */
export const requireString = (data: Frontmatter, key: string, file: string): string => {
  const value = data[key];
  if (typeof value !== "string" || value === "") throw new Error(`${file}: "${key}" is required.`);
  return value;
};

export const optionalString = (data: Frontmatter, key: string, file: string): string | undefined => {
  const value = data[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${file}: "${key}" must be a single value, not a list.`);
  return value;
};

export const optionalList = (data: Frontmatter, key: string, file: string): string[] => {
  const value = data[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${file}: "${key}" must be a [bracketed, list].`);
  return value;
};

/** True only for a real calendar date written as YYYY-MM-DD. */
export const requireDate = (data: Frontmatter, key: string, file: string): string => {
  const value = requireString(data, key, file);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${file}: "${key}" must be YYYY-MM-DD, got "${value}".`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${file}: "${key}" is not a real date ("${value}").`);
  }
  return value;
};
