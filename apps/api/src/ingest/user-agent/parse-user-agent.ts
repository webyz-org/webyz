import { UAParser } from "ua-parser-js";
import { normalizeBrowser, normalizeOS } from "../../utils/ua-normalizer.js";
import { NormalizedUserAgent } from "../types.js";

export const parseUserAgent = (userAgent: string): NormalizedUserAgent => {
  const parser = new UAParser(userAgent);

  const browser = parser.getBrowser();
  const os = parser.getOS();
  const device = parser.getDevice();

  return {
    browserFamily: normalizeBrowser(browser.name),
    browserVersion: browser.version || "Unknown",
    osFamily: normalizeOS(os.name),
    osVersion: os.version || "Unknown",
    // Lowercase is ua-parser's own convention for every other type, and the
    // breakdown capitalises for display, so store one canonical form.
    deviceType: (device.type || "desktop").toLowerCase(),
    deviceBrand: device.vendor || "Unknown",
  };
};
