import { getGeoReader, loadGeoDB } from "./geo-loader.service.js";
import { NormalizedGeo } from "./types.js";
import { geoCache } from "./geo-cache.service.js";

const empty = (): NormalizedGeo => ({
  country: "",
  subdivision1: "",
  subdivision2: "",
  city: "",
});

/**
 * The address is looked up in the local MaxMind file and remembered only in
 * this process's memory (geo-cache.service.ts, 24 hours). It must never be
 * written anywhere that outlives the process: the privacy policy says IP
 * addresses are used in memory and discarded. A Redis cache used to sit here,
 * keyed by the address for 30 days and persisted to disk by Redis, which broke
 * that promise and left 1.5 million keys on the first busy install. The lookup
 * reads a file already held in memory, so the Redis round trip it replaced
 * was slower than what it cached.
 */
export const geoLookup = async (ip?: string): Promise<NormalizedGeo> => {
  if (!ip) return empty();

  const mem = geoCache.get(ip);
  if (mem) return mem;

  try {
    // Opened on first use: nothing calls loadGeoDB at boot, and without this
    // every lookup silently returned no country.
    const reader = getGeoReader() ?? (await loadGeoDB());
    if (!reader) return empty();

    const geo = reader.get(ip);
    if (!geo) return empty();

    const result: NormalizedGeo = {
      country: geo?.country?.iso_code || "",
      subdivision1: geo?.subdivisions?.[0]?.names?.en || "",
      subdivision2: geo?.subdivisions?.[1]?.names?.en || "",
      city: geo?.city?.names?.en || "",
    };

    geoCache.set(ip, result);

    return result;
  } catch {
    return empty();
  }
};
