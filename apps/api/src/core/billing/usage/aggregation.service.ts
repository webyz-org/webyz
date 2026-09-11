import type { AppContext } from "../../../lib/context.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { parseEntitlements } from "../catalog/entitlements.schema.js";
import { countBillableEventsByHour } from "./billable.js";
import { applyPendingSpendCap } from "../spend-cap/spend-cap.service.js";
import {
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
  const queryEnd = new Date(Math.min(period.periodEnd.getTime(), startOfHour(now).getTime() + 3_600_000));

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
  // One statement for the whole period: INSERT ... ON CONFLICT (subscription,
  // hour) DO UPDATE. Prisma has no upsertMany, and a round trip per hour would
  // be 744 queries a month per subscription.
  const values = Prisma.join(
    rows.map(
      (r) =>
        Prisma.sql`(gen_random_uuid(), ${subscriptionId}, ${periodId}, ${r.hour}::timestamptz, ${BigInt(r.count)}, 'clickhouse', ${now}::timestamptz)`,
    ),
  );

  await tx.$executeRaw`
    INSERT INTO usage_buckets (id, subscription_id, billing_period_usage_id, bucket_start, quantity, source, computed_at)
    VALUES ${values}
    ON CONFLICT (subscription_id, bucket_start) DO UPDATE SET
      quantity = EXCLUDED.quantity,
      billing_period_usage_id = EXCLUDED.billing_period_usage_id,
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
