/**
 * Browser and OS version labels, one rule for every source: major.minor.
 *
 * The tracker records full versions ("128.0.0.0", "10.15.7"), GA4 exports
 * full versions too, and Plausible exports major.minor ("128.0"). Labels are
 * cut to the finest detail all three share, so a version reads as one row
 * whatever it came from; and for Chrome, which has reported 128.0.0.0-style
 * versions since its user-agent reduction, nothing real is lost.
 *
 * `VERSION_SQL` in db/clickhouse/filters.ts is the same rule for tracked
 * rows, applied when they are read, so history lines up without a backfill.
 * The two must stay identical; version.test.ts runs both over the same cases.
 */

/** Leading "major" or "major.minor"; anything not starting with a digit unchanged. */
const MAJOR_MINOR = /^\d+(?:\.\d+)?/;

export const shortVersion = (version: string): string => {
  const trimmed = version.trim();
  return MAJOR_MINOR.exec(trimmed)?.[0] ?? trimmed;
};

/**
 * A rendered "<name> <version>" label with its version cut the same way, for
 * filter values: a link or saved segment made before this rule ("Chrome
 * 128.0.0.0") still matches the row it was made from ("Chrome 128.0").
 */
export const shortVersionLabel = (label: string): string => {
  const match = /^(.*\S)\s+(\d\S*)$/.exec(label.trim());
  return match ? `${match[1]} ${shortVersion(match[2])}` : label;
};
