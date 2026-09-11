import { getGeoReader, loadGeoDB } from "./geo-loader.service.js";
import { NormalizedGeo } from "./types.js";
import { geoCache } from "./geo-cache.service.js";
import { redis } from "../../lib/redis.js";

const empty = (): NormalizedGeo => ({
  country: "",
  subdivision1: "",
  subdivision2: "",
  city: "",
});

export const geoLookup = async (ip?: string): Promise<NormalizedGeo> => {
  if (!ip) return empty();

  const mem = geoCache.get(ip);
  if (mem) return mem;

  const redisKey = `geo:ip:${ip}`;

  try {
    const cached = await redis.get(redisKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      geoCache.set(ip, parsed);
      return parsed;
    }
  } catch {}

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
    await redis.set(redisKey, JSON.stringify(result), "EX", 60 * 60 * 24 * 30); // 30 days

    return result;
  } catch {
    return empty();
  }
};
