/** Compact visitor counts: 1234 -> 1.2k */
export const formatCount = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) < 1000) return String(value);
  if (Math.abs(value) < 1_000_000)
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
};

/** Seconds -> "3m 20s" */
export const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds || 0));
  if (total < 60) return `${total}s`;

  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};

export const formatPercent = (value: number): string =>
  `${(value ?? 0).toFixed(value % 1 === 0 ? 0 : 1)}%`;

/** Cents -> $9 or $9.50 */
export const formatMoney = (cents: number, currency = "USD"): string => {
  const amount = (cents ?? 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
};

const REGION_NAMES =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

/** "IN" -> "India". Geo breakdowns return ISO-3166 alpha-2 codes. */
export const countryName = (code: string): string => {
  if (!code || code.length !== 2) return code || "Unknown";
  try {
    return REGION_NAMES?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
};

/** Flag emoji from a country code, for the geography card. */
export const countryFlag = (code: string): string => {
  if (!code || code.length !== 2) return "";
  const base = 0x1f1e6;
  return String.fromCodePoint(
    ...code
      .toUpperCase()
      .split("")
      .map((c) => base + (c.charCodeAt(0) - 65)),
  );
};

const LANGUAGE_NAMES = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" });
  } catch {
    return undefined;
  }
})();

/** "en-US" -> "American English"; falls back to the tag itself. */
export const languageName = (tag: string): string => {
  if (!tag) return "Unknown";
  try {
    return LANGUAGE_NAMES?.of(tag) ?? tag;
  } catch {
    return tag;
  }
};
