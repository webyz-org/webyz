import fs from "fs-extra";
import path from "path";

/**
 * Where the bot filter lists live.
 *
 * The live copies sit in `geo/` (the same volume as the MaxMind database) and
 * are refreshed by the `update-bot-lists` job. `lists-seed/` is written at
 * image build time so a fresh install filters from its first request instead
 * of after the first download, and an install without network egress still
 * has a list; a live copy always wins over the seed. `BOT_LISTS_DIR`
 * overrides the live directory, which is how the image build writes the
 * seed.
 */
export const LISTS_DIR = process.env.BOT_LISTS_DIR
  ? path.resolve(process.env.BOT_LISTS_DIR)
  : path.join(process.cwd(), "geo");
export const SEED_DIR = path.join(process.cwd(), "lists-seed");

export const LIST_FILES = {
  datacenter: "datacenter-ips.txt",
  datacenterAllow: "datacenter-ips-allow.txt",
  referrerSpam: "referrer-spam.txt",
} as const;

export type ListName = keyof typeof LIST_FILES;

export const listPath = (name: ListName) => path.join(LISTS_DIR, LIST_FILES[name]);

const read = async (file: string): Promise<string | null> => {
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`List load failed: ${file}`, err);
    }
    return null;
  }
};

/** The live list, else the seed baked into the image, else null. */
export const readList = async (name: ListName): Promise<{ text: string; source: string } | null> => {
  const live = await read(listPath(name));
  if (live !== null) return { text: live, source: "live" };
  const seed = await read(path.join(SEED_DIR, LIST_FILES[name]));
  return seed === null ? null : { text: seed, source: "seed" };
};
