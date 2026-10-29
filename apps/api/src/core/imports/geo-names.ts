import { loadGeoDB } from "../geo/geo-loader.service.js";

/**
 * Names for the location codes another tool exports. Plausible stores a
 * region as its ISO 3166-2 code ("US-CA") and a city as its GeoNames id
 * (5391959); Webyz shows the English names MaxMind gives at ingest. Both come
 * out of the same GeoLite2 database, so walking it once yields labels that
 * match tracked rows exactly, with no second geographic dataset to ship.
 *
 * The walk reads every record of the search tree (about 1.5 s and a few
 * hundred MB while it runs on the 2024-era database), so it is built on first
 * use by an import and dropped after a quiet half hour.
 */
export type GeoNames = {
  /** GeoNames id -> English city name. */
  cities: Map<number, string>;
  /** "CC-SUB" -> English subdivision name. */
  regions: Map<string, string>;
  /** "CC\u0000name" -> "CC-SUB", for writing an export in Plausible's format. */
  regionCodes: Map<string, string>;
  /**
   * "CC\u0000name" -> GeoNames id. Where a country has two cities of one
   * name, the first the database lists wins; tracked rows keep only the name.
   */
  cityIds: Map<string, number>;
};

type MmdbInternals = {
  metadata: { nodeCount: number; nodeByteSize: number };
  walker: { left: (offset: number) => number; right: (offset: number) => number };
  resolveDataPointer: (pointer: number) => GeoRecord | null;
};

type GeoRecord = {
  country?: { iso_code?: string };
  city?: { geoname_id?: number; names?: { en?: string } };
  subdivisions?: Array<{ iso_code?: string; names?: { en?: string } }>;
};

const IDLE_MS = 30 * 60_000;
let cached: GeoNames | null = null;
let idleTimer: NodeJS.Timeout | null = null;

const keepFor = () => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    cached = null;
  }, IDLE_MS);
  idleTimer.unref();
};

/** Build the maps from any mmdb-lib reader; exported for tests. */
export const buildGeoNames = (reader: MmdbInternals): GeoNames => {
  const { nodeCount, nodeByteSize } = reader.metadata;
  const pointers = new Set<number>();
  for (let node = 0; node < nodeCount; node++) {
    const offset = node * nodeByteSize;
    const left = reader.walker.left(offset);
    const right = reader.walker.right(offset);
    if (left > nodeCount) pointers.add(left);
    if (right > nodeCount) pointers.add(right);
  }
  const cities = new Map<number, string>();
  const regions = new Map<string, string>();
  const regionCodes = new Map<string, string>();
  const cityIds = new Map<string, number>();
  for (const pointer of pointers) {
    const record = reader.resolveDataPointer(pointer);
    const city = record?.city;
    const country = record?.country?.iso_code;
    if (city?.geoname_id && city.names?.en) {
      cities.set(city.geoname_id, city.names.en);
      const key = `${country ?? ""}\u0000${city.names.en}`;
      if (country && !cityIds.has(key)) cityIds.set(key, city.geoname_id);
    }
    const sub = record?.subdivisions?.[0];
    if (country && sub?.iso_code && sub.names?.en) {
      regions.set(`${country}-${sub.iso_code}`, sub.names.en);
      regionCodes.set(`${country}\u0000${sub.names.en}`, `${country}-${sub.iso_code}`);
    }
  }
  return { cities, regions, regionCodes, cityIds };
};

/**
 * The maps, or empty ones when no geo database is installed: then regions and
 * cities are left out of the import (countries still import) and the import
 * says so.
 */
export const getGeoNames = async (): Promise<GeoNames | null> => {
  if (cached) {
    keepFor();
    return cached;
  }
  const db = await loadGeoDB();
  // maxmind's Reader wraps mmdb-lib's, whose tree walker is not public API.
  const inner = (db as unknown as { reader?: MmdbInternals } | null)?.reader ?? (db as unknown as MmdbInternals | null);
  if (!inner?.walker || !inner.metadata) return null;
  cached = buildGeoNames(inner);
  keepFor();
  return cached;
};
