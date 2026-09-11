import { addDays, offsetAt, partsOf, wallClockToEpochMs } from "../../http/normalize/period.js";

/**
 * Which period a scheduled report covers, and when it may go out.
 *
 * Everything is computed in the site's own timezone from an explicit `now`,
 * so the rule is testable and a restart cannot move a boundary:
 *
 * - WEEKLY covers the most recent full Monday-to-Sunday week and is due once
 *   the clock passes Monday SEND_HOUR local.
 * - MONTHLY covers the previous calendar month and is due once the clock
 *   passes the 1st at SEND_HOUR local.
 *
 * `to` is exclusive (local midnight ending the period), matching every other
 * period in the API. The job compares it with `email_reports.last_period_end`.
 */

export type ReportFrequency = "WEEKLY" | "MONTHLY";

/** Local hour at which a completed period's report becomes due. */
export const SEND_HOUR = 9;

export type ReportPeriod = {
  frequency: ReportFrequency;
  /** Epoch seconds, inclusive start of the period. */
  from: number;
  /** Epoch seconds, exclusive end of the period. */
  to: number;
  /** Same window shifted back by its own length, for the comparison column. */
  compareFrom: number;
  compareTo: number;
  /** Epoch ms at which the report for this period may be sent. */
  sendAt: number;
  /** True once `now` is at or past `sendAt`. */
  due: boolean;
  /** Human label, e.g. "1 Sep to 7 Sep 2026" or "August 2026". */
  label: string;
};

type LocalDate = { year: number; month: number; day: number };

const toSeconds = (ms: number) => Math.floor(ms / 1000);

/** Epoch ms of a local wall-clock hour on a local date, DST-aware. */
const localHourToEpochMs = (date: LocalDate, hour: number, timeZone: string) => {
  const naive = Date.UTC(date.year, date.month - 1, date.day, hour, 0, 0);
  let epoch = naive - offsetAt(naive, timeZone);
  epoch = naive - offsetAt(epoch, timeZone);
  return epoch;
};

/** 0 = Monday ... 6 = Sunday for a calendar date. */
const mondayBasedWeekday = (d: LocalDate) => (new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() + 6) % 7;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

const previousMonth = (d: LocalDate): LocalDate =>
  d.month === 1 ? { year: d.year - 1, month: 12, day: 1 } : { year: d.year, month: d.month - 1, day: 1 };

/** The most recent completed period of `frequency` as of `now`, in `timeZone`. */
export const completedReportPeriod = (
  frequency: ReportFrequency,
  now: Date,
  timeZone: string,
  sendHour = SEND_HOUR,
): ReportPeriod => {
  const p = partsOf(now.getTime(), timeZone);
  const today: LocalDate = { year: p.year, month: p.month, day: p.day };

  let start: LocalDate;
  let end: LocalDate;
  let label: string;

  if (frequency === "WEEKLY") {
    // The Monday that starts the current week is the exclusive end of the
    // last complete week.
    end = addDays(today, -mondayBasedWeekday(today));
    start = addDays(end, -7);
    const last = addDays(end, -1);
    const sameMonth = start.month === last.month && start.year === last.year;
    label = sameMonth
      ? `${start.day} to ${last.day} ${SHORT_MONTHS[last.month - 1]} ${last.year}`
      : `${start.day} ${SHORT_MONTHS[start.month - 1]}${start.year !== last.year ? ` ${start.year}` : ""} to ${last.day} ${SHORT_MONTHS[last.month - 1]} ${last.year}`;
  } else {
    end = { year: today.year, month: today.month, day: 1 };
    start = previousMonth(end);
    label = `${MONTHS[start.month - 1]} ${start.year}`;
  }

  const from = toSeconds(wallClockToEpochMs(start, timeZone));
  const to = toSeconds(wallClockToEpochMs(end, timeZone));
  const sendAt = localHourToEpochMs(end, sendHour, timeZone);

  return {
    frequency,
    from,
    to,
    compareFrom: from - (to - from),
    compareTo: from,
    sendAt,
    due: now.getTime() >= sendAt,
    label,
  };
};

/** Whether `lastPeriodEnd` (an instant) already covers a period ending at `to` seconds. */
export const alreadyReported = (lastPeriodEnd: Date | null | undefined, to: number) =>
  Boolean(lastPeriodEnd) && Math.floor(lastPeriodEnd!.getTime() / 1000) >= to;

/** YYYY-MM-DD of an instant (epoch seconds) in `timeZone`, for dashboard links. */
export const localDateString = (epochSeconds: number, timeZone: string) => {
  const p = partsOf(epochSeconds * 1000, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};
