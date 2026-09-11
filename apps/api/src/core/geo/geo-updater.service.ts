import axios from "axios";
import fs from "fs-extra";
import path from "path";
import * as tar from "tar";
import { pipeline } from "stream/promises";

import { loadGeoDB } from "./geo-loader.service.js";
import { MAXMIND_LICENSE_KEY } from "../../config/env.js";

const GEO_URL = `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz`;

/**
 * Downloads GeoLite2-City into geo/ and swaps it into place. The download and
 * extraction happen in a scratch directory next to the live file, so a failed
 * or interrupted update leaves the database that was there; it used to empty
 * the directory first, which turned any download error into no geography at
 * all until the next weekly run.
 */
export const updateGeoDB = async () => {
  const geoDir = path.join(process.cwd(), "geo");
  const workDir = path.join(geoDir, ".download");

  try {
    if (!MAXMIND_LICENSE_KEY) {
      throw new Error("MAXMIND_LICENSE_KEY missing");
    }

    console.log("🌍 Updating Geo DB...");

    await fs.emptyDir(workDir);
    const tarPath = path.join(workDir, "geo.tar.gz");

    const res = await axios({
      url: GEO_URL,
      method: "GET",
      responseType: "stream",
      timeout: 1000 * 60 * 5,
    });

    await pipeline(res.data, fs.createWriteStream(tarPath));
    await tar.x({ file: tarPath, cwd: workDir });

    const files = await fs.readdir(workDir);
    const folder = files.find((f) => f.startsWith("GeoLite2-City") && !f.endsWith(".tar.gz"));
    if (!folder) {
      throw new Error("GeoLite folder not found after extract");
    }

    const mmdb = path.join(workDir, folder, "GeoLite2-City.mmdb");
    const finalPath = path.join(geoDir, "GeoLite2-City.mmdb");
    // Same directory as the destination, so the rename is atomic.
    const tmpPath = path.join(geoDir, "GeoLite2-City.tmp.mmdb");

    await fs.copy(mmdb, tmpPath);
    await fs.move(tmpPath, finalPath, { overwrite: true });

    console.log("✅ Geo DB updated");

    await loadGeoDB(true);
  } catch (err) {
    console.error("Geo update failed", err);
  } finally {
    await fs.remove(workDir).catch(() => undefined);
  }
};
