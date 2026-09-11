/** "just now", "12s ago", "3m ago" - relative labels for the realtime UI. */
export const timeAgo = (now: number, ts: number): string => {
  const diff = Math.max(0, now - ts);
  if (diff < 8) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
};

/** Ingest stores "Chrome 140.0.0.0"; the realtime UI only wants "Chrome". */
export const browserLabel = (browser: string): string =>
  browser.replace(/[\s/][\d.]+$/, "").trim();

/** "18:28:04" wall-clock label for activity timelines. */
export const clockLabel = (ts: number): string =>
  new Date(ts * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
