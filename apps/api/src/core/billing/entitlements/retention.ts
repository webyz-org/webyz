import type { AppContext } from "../../../lib/context.js";
import { clampToFloor, resolvePeriod, retentionFloor } from "../../../http/normalize/period.js";
import { getEntitlements, getLimit } from "./entitlement.service.js";

/**
 * Data retention as an access rule, not a deletion rule.
 *
 * Every analytics read resolves its period here so the plan's
 * `retention_days` bounds what a query can see: the window is cut at local
 * midnight `retention_days` days ago in the site's own timezone, whatever
 * `period`, `from` or `to` the client sent. Nothing older is deleted; it is
 * simply not queryable until the account moves to a plan that retains it.
 *
 * The owner's plan applies, not the viewer's: a public dashboard shows what
 * the site's owner is entitled to.
 */

export type PeriodQuery = { period?: string; date?: string; from?: string; to?: string };

export type RetainedWindow = {
  from: number;
  to: number;
  retention: {
    /** Days of history the owner's plan includes. */
    days: number;
    /** Epoch seconds of the earliest queryable instant. */
    floor: number;
    /** The requested window reached back past the floor and was cut. */
    clamped: boolean;
    /** The requested window lay entirely before the floor; queries return nothing. */
    empty: boolean;
  };
};

export const resolveRetainedWindow = async (
  ctx: Pick<AppContext, "prisma" | "redis">,
  input: { ownerId: string; timezone: string; query: PeriodQuery; defaultPeriod?: string; now?: number },
): Promise<RetainedWindow> => {
  const range = resolvePeriod({
    period: input.query.period ?? input.defaultPeriod ?? "last_28_days",
    date: input.query.date,
    from: input.query.from,
    to: input.query.to,
    timezone: input.timezone,
  });
  const { entitlements } = await getEntitlements(ctx, input.ownerId);
  const days = getLimit(entitlements, "retention_days");
  const floor = retentionFloor({ retentionDays: days, timezone: input.timezone, now: input.now });
  const clamped = clampToFloor(range, floor);
  return {
    from: clamped.from,
    to: clamped.to,
    retention: { days, floor, clamped: clamped.clamped, empty: clamped.empty },
  };
};

/** The `meta.retention` block analytics responses carry so the dashboard can say what was cut. */
export const retentionMeta = (window: RetainedWindow) => ({
  range: { from: window.from, to: window.to },
  retention: window.retention,
});
