// Generates src/features/realtime/country-centroids.json:
//   { "IN": [78.4, 22.9], ... }  (ISO-2 -> [longitude, latitude])
//
// Centroids are computed from world-atlas country polygons and keyed by the
// ISO-2 codes MaxMind writes into events.country. Run once and commit the
// output; rerun only when world-atlas is upgraded:
//   node scripts/generate-country-centroids.mjs
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { geoCentroid } from "d3-geo";
import { feature } from "topojson-client";

const require = createRequire(import.meta.url);
const countries = require("i18n-iso-countries");

const atlasPath = require.resolve("world-atlas/countries-110m.json");
const topology = JSON.parse(await readFile(atlasPath, "utf8"));
const { features } = feature(topology, topology.objects.countries);

const centroids = {};
for (const f of features) {
  const alpha2 = countries.numericToAlpha2(String(f.id).padStart(3, "0"));
  if (!alpha2) continue;
  const [lon, lat] = geoCentroid(f);
  centroids[alpha2] = [Number(lon.toFixed(2)), Number(lat.toFixed(2))];
}

const out = new URL(
  "../src/features/realtime/country-centroids.json",
  import.meta.url,
);
await writeFile(out, JSON.stringify(centroids));
console.log(`Wrote ${Object.keys(centroids).length} centroids to ${out.pathname}`);
