const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Bucket labels arrive as "YYYY-MM-DD HH:mm:00" already in the site's
 * timezone, so they are formatted as strings; parsing them as dates would
 * re-apply the browser's offset (same rule as MainGraph).
 */
export const formatBucketLabel = (label: string, interval: string): string => {
  const [datePart, timePart] = label.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const name = MONTHS[(month ?? 1) - 1] ?? "";

  switch (interval) {
    case "minute":
    case "hour":
      return `${name} ${day}, ${(timePart ?? "00:00").slice(0, 5)}`;
    case "month":
      return `${name} ${year}`;
    default:
      return `${name} ${day}`;
  }
};
