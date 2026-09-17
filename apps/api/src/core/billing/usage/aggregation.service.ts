import type { AppContext } from "../../../lib/context.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { parseEntitlements } from "../catalog/entitlements.schema.js";
import { countBillableEventsByHour } from "./billable.js";
import { applyPendingSpendCap } from "../spend-cap/spend-cap.service.js";
import {
  HOUR_MS,
  splitHourRows,
  startOfHour,
  sumCounts,
  type HourRow,
} from "./usage-math.js";

type Deps = Pick<AppContext, "prisma" | "clickhouse">;

/** The subscription fields the ledger needs. */
export type LedgerSubscription = {
  id: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  plan: { entitlements: unknown };
  user: { websites: { id: string }[] };
};

export type AggregationResult = {
  periodId: string;
  totalEvents: number;
  includedEvents: number;
  overageEvents: number;
  closedBuckets: number;
  liveHourEvents: number;
};

/**
 * Make sure the subscription's current period has an OPEN usage row, and close
 * any older OPEN rows that the period has rolled past.
 *
 * Rollover is therefore handled in one place regardless of what moved the
 * subscription's dates: a provider renewal webhook or the local period roll.
 * Closing a period runs its final aggregation so the history is exact.
 */
export const ensureOpenPeriod = async (
  deps: Deps,
  sub: LedgerSubscription,
  now: Date = new Date(),
) => {
  const { prisma } = deps;
  const included = BigInt(parseEntitlements(sub.plan.entitlements).events_per_period);

  const stale = await prisma.billingPeriodUsage.findMany({
    where: {
      subscriptionId: sub.id,
      status: "OPEN",
      periodStart: { not: sub.currentPeriodStart },
    },
    select: { id: true, periodStart: true, periodEnd: true },
  });

  for (const period of stale) {
    await aggregatePeriod(deps, sub, { ...period, includedEvents: included }, now);
    await prisma.billingPeriodUsage.update({
      where: { id: period.id },
      data: { status: "CLOSED", closedAt: now },
    });
    // A lowered spending cap deferred during the old period starts now.
    await applyPendingSpendCap(prisma, sub.id);
    console.log(`[usage] closed period ${period.id} for sub ${sub.id}`);
  }

  return prisma.billingPeriodUsage.upsert({
    where: {
      subscriptionId_periodStart: { subscriptionId: sub.id, periodStart: sub.currentPeriodStart },
    },
    update: { periodEnd: sub.currentPeriodEnd, includedEvents: included },
    create: {
      subscriptionId: sub.id,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
      includedEvents: included,
      status: "OPEN",
    },
    select: { id: true, periodStart: true, periodEnd: true, includedEvents: true, status: true },
  });
};

/**
 * Close every OPEN period on a subscription that is being retired.
 *
 * The usage sync only visits live subscriptions, so an OPEN period left on a
 * retired one is frozen at whatever the last hourly run wrote and is invisible
 * to everything downstream: `chargeOverage` considers CLOSED periods only, and
 * reconciliation walks closed periods.
 *
 * Cancellation paths call this directly, but not all of them can: a sync that
 * finds the provider has already cancelled or paused the subscription takes an
 * early return before it knows which rows it retired, and account deletion
 * drops the rows entirely. `closeStrandedPeriods` below is the net that catches
 * whatever a call site misses, so this is not the only way a period closes.
 *
 * Pass `clickhouse` to aggregate each period one final time first, so the
 * stored total covers every event up to the moment it closes. That matters
 * where the period can still be billed, which means a provider-backed
 * subscription. A free or trial row has no card and no charge path, so its
 * periods close at the last synced total and the caller need not hold a
 * ClickHouse client to retire one.
 *
 * Safe to call twice: a period already CLOSED is not selected.
 */
export const closeOpenPeriods = async (
  deps: Pick<AppContext, "prisma"> & Partial<Pick<AppContext, "clickhouse">>,
  subscriptionId: string,
  now: Date = new Date(),
): Promise<{ closed: string[] }> => {
  const { prisma, clickhouse } = deps;

  const open = await prisma.billingPeriodUsage.findMany({
    where: { subscriptionId, status: "OPEN" },
    select: { id: true, periodStart: true, periodEnd: true, includedEvents: true },
  });
  if (open.length === 0) return { closed: [] };

  const sub = clickhouse
    ? await prisma.subscription.findUnique({
        where: { id: subscriptionId },
        select: {
          id: true,
          plan: { select: { entitlements: true } },
          user: { select: { websites: { select: { id: true } } } },
        },
      })
    : null;

  const closed: string[] = [];
  for (const period of open) {
    if (clickhouse && sub) {
      // The period's own dates drive the final aggregation, not the
      // subscription's: those may already have been moved on by whatever is
      // retiring it.
      const ledgerSub: LedgerSubscription = {
        id: sub.id,
        currentPeriodStart: period.periodStart,
        currentPeriodEnd: period.periodEnd,
        plan: sub.plan,
        user: sub.user,
      };
      // A cancellation lands mid-hour, inside a period whose end is still in
      // the future, so the hour containing `now` would be treated as the live
      // hour: counted into the total but never written as a bucket, leaving a
      // CLOSED period whose total disagrees with its own buckets. Close the
      // window at `now` and aggregate as if the next hour boundary had already
      // passed, which flushes that partial hour into a bucket of its own.
      const clippedEnd = new Date(Math.min(period.periodEnd.getTime(), now.getTime()));
      const pastTheHour = new Date(startOfHour(now).getTime() + HOUR_MS);
      try {
        await aggregatePeriod(
          { prisma, clickhouse },
          { ...ledgerSub, currentPeriodEnd: clippedEnd },
          { ...period, periodEnd: clippedEnd },
          pastTheHour,
        );
      } catch (err) {
        // Closing must not depend on the analytics store being reachable. A
        // period left OPEN on a retired subscription is never charged at all,
        // which is strictly worse than one closed at the last synced total, so
        // close it and make the shortfall loud rather than silent: the stored
        // total may be short by up to the time since the last hourly sync.
        console.error(
          `[usage] ANOMALY final aggregation failed for period ${period.id} on retired sub ${subscriptionId}; ` +
            `closing at the last synced total, which may undercount: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    await prisma.billingPeriodUsage.update({
      where: { id: period.id },
      data: { status: "CLOSED", closedAt: now },
    });
    closed.push(period.id);
    console.log(`[usage] closed period ${period.id} on retired sub ${subscriptionId}`);
  }

  return { closed };
};

/**
 * Safety net for periods left OPEN on a subscription that is no longer live.
 *
 * Every cancellation path closes its own periods, but that happens after the
 * transaction that retires the row, so a crash in between would strand one
 * where the hourly sync never looks again. Closing is deliberately done at the
 * stored total with no final aggregation: by the time this runs the period is
 * historical, and re-reading ClickHouse for a window the retention cut may
 * have since trimmed could only move the total down.
 */
export const closeStrandedPeriods = async (
  deps: Pick<AppContext, "prisma">,
  /** Restrict to these subscriptions. Tests must pass it; cron passes nothing. */
  scope?: { subscriptionIds?: string[] },
): Promise<number> => {
  const { prisma } = deps;

  const stranded = await prisma.billingPeriodUsage.findMany({
    where: {
      ...(scope?.subscriptionIds ? { subscriptionId: { in: scope.subscriptionIds } } : {}),
      status: "OPEN",
      subscription: { status: { notIn: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    },
    select: { subscriptionId: true },
    distinct: ["subscriptionId"],
  });

  let count = 0;
  for (const { subscriptionId } of stranded) {
    const { closed } = await closeOpenPeriods({ prisma }, subscriptionId);
    count += closed.length;
    for (const id of closed) {
      console.warn(`[usage] closed period ${id} stranded OPEN on retired sub ${subscriptionId}`);
    }
  }
  return count;
};

/**
 * Recompute a period's usage from ClickHouse.
 *
 * One grouped query yields billable events per hour for the whole period so
 * far. Fully elapsed hours are upserted as buckets (idempotent on
 * subscription + hour, so late events and re-runs simply overwrite). The
 * current hour is counted live and never stored, so a bucket is only ever
 * written once the hour it describes cannot change.
 *
 * total = sum(closed buckets) + live hour. Written to the period row together
 * with the buckets in one transaction, so the row can never disagree with its
 * buckets.
 */
export const aggregatePeriod = async (
  deps: Deps,
  sub: LedgerSubscription,
  period: { id: string; periodStart: Date; periodEnd: Date; includedEvents: bigint },
  now: Date = new Date(),
): Promise<AggregationResult> => {
  const { prisma, clickhouse } = deps;
  const websiteIds = sub.user.websites.map((w) => w.id);

  // Query to the end of the current hour, or to the period end, whichever is
  // sooner. A closed period is aggregated to its own end.
  const queryEnd = new Date(Math.min(period.periodEnd.getTime(), startOfHour(now).getTime() + HOUR_MS));

  const rows: HourRow[] =
    websiteIds.length === 0 || queryEnd <= period.periodStart
      ? []
      : await countBillableEventsByHour(clickhouse, websiteIds, period.periodStart, queryEnd);

  const { closed, live } = splitHourRows(rows, period.periodStart, period.periodEnd, now);
  const totalEvents = sumCounts(closed) + live;
  const includedEvents = Number(period.includedEvents);
  const overageEvents = Math.max(0, totalEvents - includedEvents);

  await prisma.$transaction(async (tx) => {
    if (closed.length) {
      await upsertBuckets(tx, sub.id, period.id, closed, now);
    }

    // Hours that had events last run but none now (a site was deleted and its
    // rows purged) must not linger. Remove closed buckets in range that the
    // query no longer returned.
    const keep = closed.map((r) => r.hour);
    await tx.usageBucket.deleteMany({
      where: {
        billingPeriodUsageId: period.id,
        bucketStart: { lt: startOfHour(now), notIn: keep },
      },
    });

    await tx.billingPeriodUsage.update({
      where: { id: period.id },
      data: {
        totalEvents: BigInt(totalEvents),
        overageEvents: BigInt(overageEvents),
      },
    });
  });

  return {
    periodId: period.id,
    totalEvents,
    includedEvents,
    overageEvents,
    closedBuckets: closed.length,
    liveHourEvents: live,
  };
};

const upsertBuckets = async (
  tx: Prisma.TransactionClient,
  subscriptionId: string,
  periodId: string,
  rows: HourRow[],
  now: Date,
) => {
  // One statement for the whole period: INSERT ... ON CONFLICT (period, hour)
  // DO UPDATE. Prisma has no upsertMany, and a round trip per hour would be
  // 744 queries a month per subscription.
  const values = Prisma.join(
    rows.map(
      (r) =>
        Prisma.sql`(gen_random_uuid(), ${subscriptionId}, ${periodId}, ${r.hour}::timestamptz, ${BigInt(r.count)}, 'clickhouse', ${now}::timestamptz)`,
    ),
  );

  await tx.$executeRaw`
    INSERT INTO usage_buckets (id, subscription_id, billing_period_usage_id, bucket_start, quantity, source, computed_at)
    VALUES ${values}
    ON CONFLICT (billing_period_usage_id, bucket_start) DO UPDATE SET
      quantity = EXCLUDED.quantity,
      computed_at = EXCLUDED.computed_at
  `;
};

/**
 * Cross-check a period row against its buckets. The stored total must equal
 * the bucket sum plus a live hour that is at most one hour of traffic; a
 * mismatch beyond that means a write was lost. Used by reconciliation.
 */
export const verifyPeriodAgainstBuckets = async (
  { prisma }: Pick<AppContext, "prisma">,
  periodId: string,
): Promise<{ storedTotal: bigint; bucketSum: bigint; consistent: boolean }> => {
  const [period, agg] = await Promise.all([
    prisma.billingPeriodUsage.findUniqueOrThrow({
      where: { id: periodId },
      select: { totalEvents: true, status: true },
    }),
    prisma.usageBucket.aggregate({
      where: { billingPeriodUsageId: periodId },
      _sum: { quantity: true },
    }),
  ]);
  const bucketSum = agg._sum.quantity ?? BigInt(0);
  // A closed period has no live hour, so it must match exactly.
  const consistent =
    period.status === "CLOSED" ? period.totalEvents === bucketSum : period.totalEvents >= bucketSum;
  return { storedTotal: period.totalEvents, bucketSum, consistent };
};
