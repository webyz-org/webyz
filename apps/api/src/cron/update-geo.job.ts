import { MAXMIND_LICENSE_KEY } from "../config/env.js";
import { updateGeoDB } from "../core/geo/geo-updater.service.js";

export async function updateGeoJob(): Promise<void | "skipped"> {
  if (!MAXMIND_LICENSE_KEY) {
    console.log("[cron] update-geo skipped: MAXMIND_LICENSE_KEY not set");
    return "skipped";
  }

  console.log("[cron] update geo job");
  await updateGeoDB();
}
