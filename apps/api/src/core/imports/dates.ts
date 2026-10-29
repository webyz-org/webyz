/** Calendar-date helpers for import ranges, all on YYYY-MM-DD strings. */

export const isIsoDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export const addDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Today's date in a timezone. */
export const localToday = (timezone: string, now: Date = new Date()) => localDate(now.getTime() / 1000, timezone);

/** The local date of a Unix-seconds instant in a timezone. */
export const localDate = (epochSeconds: number, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(epochSeconds * 1000),
  );
