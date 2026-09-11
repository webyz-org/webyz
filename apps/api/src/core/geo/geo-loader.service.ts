import maxmind, { Reader } from "maxmind";
import path from "path";

let reader: Reader<any> | null = null;

/**
 * Opens geo/GeoLite2-City.mmdb. A missing file is logged, not thrown, and
 * every later call tries again, which is how a database downloaded after boot
 * comes into use without a restart. `reload` forces a fresh open after the
 * updater has swapped the file, so lookups move to the new edition.
 */
export const loadGeoDB = async (reload = false) => {
  if (reader && !reload) return reader;

  try {
    const dbPath = path.join(process.cwd(), "geo/GeoLite2-City.mmdb");
    reader = await maxmind.open(dbPath);
    console.log("🌍 Geo DB loaded");
  } catch (err) {
    console.error("Geo DB load failed", err);
  }

  return reader;
};

export const getGeoReader = () => reader;
