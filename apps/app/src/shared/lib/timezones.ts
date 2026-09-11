/**
 * Every IANA zone the browser knows, so anyone can pick their own rather
 * than the ten we happened to list. Older browsers without
 * Intl.supportedValuesOf get a short fallback plus their own zone.
 */
export const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const FALLBACK = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export const allTimezones = (): string[] => {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  let zones: string[];
  try {
    zones = supported ? supported.call(Intl, "timeZone") : FALLBACK;
  } catch {
    zones = FALLBACK;
  }
  return Array.from(new Set([browserTimezone(), "UTC", ...zones]));
};

/** The list with the given zone included even if the browser does not know it. */
export const timezonesIncluding = (zone: string | undefined): string[] => {
  const zones = allTimezones();
  return zone && !zones.includes(zone) ? [zone, ...zones] : zones;
};
