import { invalidPeriod } from "../../errors/domain-errors.js";

/**
 * Resolve a dashboard period into an epoch-second window in the site's own
 * timezone.
 *
 * `to` is always exclusive: "today" runs from local midnight up to, but not
 * including, tomorrow's local midnight.
 *
 * Timezone maths is done with Intl rather than a date library because the
 * previous implementation round-tripped through date-fns-tz twice (shift the
 * clock, then reinterpret it) and came out a whole zone offset wrong, which
 * made the graph's buckets and its axis disagree.
 */

export type ZonedFields = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export const partsOf = (epochMs: number, timeZone: string): ZonedFields => {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const found: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") found[part.type] = part.value;
  }

  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    // Intl can emit hour "24" for midnight in some locales/zones.
    hour: Number(found.hour) % 24,
    minute: Number(found.minute),
    second: Number(found.second),
  };
};

/** Offset of the zone from UTC, in ms, at a given instant. */
export const offsetAt = (epochMs: number, timeZone: string): number => {
  const p = partsOf(epochMs, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - epochMs;
};

/**
 * Epoch ms for a wall-clock time in a timezone. Applied twice because the
 * offset itself depends on the instant, which matters across a DST boundary.
 */
export const wallClockToEpochMs = (
  fields: { year: number; month: number; day: number },
  timeZone: string,
): number => {
  const naive = Date.UTC(fields.year, fields.month - 1, fields.day, 0, 0, 0);
  let epoch = naive - offsetAt(naive, timeZone);
  epoch = naive - offsetAt(epoch, timeZone);
  return epoch;
};

export const addDays = (
  f: { year: number; month: number; day: number },
  days: number,
) => {
  const d = new Date(Date.UTC(f.year, f.month - 1, f.day));
  d.setUTCDate(d.getUTCDate() + days);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
};

const toSeconds = (ms: number) => Math.floor(ms / 1000);

// ─── Retention ───────────────────────────────────────────────────────────────

/**
 * The earliest instant a plan with `retentionDays` of history may query:
 * local midnight, in the site's timezone, `retentionDays` days before today.
 * Same day semantics as every period above, so "last 90 days" on a 90 day
 * plan is exactly the retained window.
 */
export const retentionFloor = ({
  retentionDays,
  timezone = "UTC",
  now = Date.now(),
}: {
  retentionDays: number;
  timezone?: string;
  now?: number;
}): number => {
  const p = partsOf(now, timezone);
  const floorDay = addDays({ year: p.year, month: p.month, day: p.day }, -Math.max(0, Math.floor(retentionDays)));
  return toSeconds(wallClockToEpochMs(floorDay, timezone));
};

export type ClampedRange = {
  from: number;
  to: number;
  /** True when the requested window started before the floor and was cut. */
  clamped: boolean;
  /** True when nothing of the requested window lies inside retention. */
  empty: boolean;
};

/**
 * Restrict a resolved window to what the plan retains. A window that starts
 * before the floor is cut at the floor; a window that ends at or before the
 * floor becomes the empty window [floor, floor), so the caller's queries run
 * and return nothing rather than failing. `to` is never moved later.
 */
export const clampToFloor = (range: { from: number; to: number }, floor: number): ClampedRange => {
  if (range.to <= floor) return { from: floor, to: floor, clamped: true, empty: true };
  if (range.from < floor) return { from: floor, to: range.to, clamped: true, empty: false };
  return { from: range.from, to: range.to, clamped: false, empty: false };
};

export function resolvePeriod({
  period,
  date,
  from,
  to,
  timezone = "UTC",
}: {
  period: string;
  date?: string;
  from?: string;
  to?: string;
  timezone?: string;
}): { from: number; to: number } {
  // The local calendar day the period is anchored on.
  const anchor = date
    ? (() => {
        const [y, m, d] = date.split("-").map(Number);
        if (!y || !m || !d) throw invalidPeriod(period);
        return { year: y, month: m, day: d };
      })()
    : (() => {
        const p = partsOf(Date.now(), timezone);
        return { year: p.year, month: p.month, day: p.day };
      })();

  const startOf = (f: { year: number; month: number; day: number }) =>
    toSeconds(wallClockToEpochMs(f, timezone));

  const today = anchor;
  const tomorrow = addDays(today, 1);

  switch (period) {
    case "today":
      return { from: startOf(today), to: startOf(tomorrow) };

    // Rolling 24 hours, aligned to the site's local hour boundaries so the
    // hourly graph gets 24 whole buckets including the current partial hour.
    case "last_24_hours": {
      const nowParts = partsOf(Date.now(), timezone);
      const nextHour =
        startOf({
          year: nowParts.year,
          month: nowParts.month,
          day: nowParts.day,
        }) +
        (nowParts.hour + 1) * 3600;
      return { from: nextHour - 24 * 3600, to: nextHour };
    }

    case "yesterday":
      return { from: startOf(addDays(today, -1)), to: startOf(today) };

    case "last_7_days":
      return { from: startOf(addDays(today, -6)), to: startOf(tomorrow) };

    case "last_28_days":
      return { from: startOf(addDays(today, -27)), to: startOf(tomorrow) };

    case "last_30_days":
      return { from: startOf(addDays(today, -29)), to: startOf(tomorrow) };

    case "last_91_days":
      return { from: startOf(addDays(today, -90)), to: startOf(tomorrow) };

    case "this_month":
      return {
        from: startOf({ year: today.year, month: today.month, day: 1 }),
        to: startOf(tomorrow),
      };

    case "last_month": {
      const firstOfThis = { year: today.year, month: today.month, day: 1 };
      const lastMonth =
        today.month === 1
          ? { year: today.year - 1, month: 12, day: 1 }
          : { year: today.year, month: today.month - 1, day: 1 };
      return { from: startOf(lastMonth), to: startOf(firstOfThis) };
    }

    case "this_year":
      return {
        from: startOf({ year: today.year, month: 1, day: 1 }),
        to: startOf(tomorrow),
      };

    case "last_12_months":
      return {
        from: startOf({
          year: today.year - 1,
          month: today.month,
          day: today.day,
        }),
        to: startOf(tomorrow),
      };

    case "all_time":
      return { from: 0, to: startOf(tomorrow) };

    case "custom": {
      if (!from || !to) throw invalidPeriod("custom requires from and to");
      const [fy, fm, fd] = from.split("-").map(Number);
      const [ty, tm, td] = to.split("-").map(Number);
      if (!fy || !fm || !fd || !ty || !tm || !td) {
        throw invalidPeriod("custom requires YYYY-MM-DD from and to");
      }
      return {
        from: startOf({ year: fy, month: fm, day: fd }),
        // Inclusive end date, exclusive boundary.
        to: startOf(addDays({ year: ty, month: tm, day: td }, 1)),
      };
    }

    default:
      throw invalidPeriod(period);
  }
}
