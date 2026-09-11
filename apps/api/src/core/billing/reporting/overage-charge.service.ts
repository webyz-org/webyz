import type { AppContext } from "../../../lib/context.js";
import { BILLING_CONFIG } from "../catalog/billing.config.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { BillingProvider } from "../provider/billing-provider.js";

/**
 * Billing the overage a period accrued.
 *
 * The ledger (billing_period_usages + usage_buckets) is authoritative and is
 * never written here. This module only advances a checkpoint,
 * `reportedEvents`, and only after the provider has accepted the charge.
 *
 * Paddle has no usage metering, so overage is not streamed as it happens: a
 * period is charged once, when it closes, for everything above the allowance.
 * That also means the customer sees one line per month rather than a running
 * meter, and an annual customer is billed monthly for usage as the terms say.
 *
 * Per period, per run:
 *   1. If a PENDING or FAILED charge exists, retry it unchanged. Its key and
 *      quantity are fixed, and the provider deduplicates on the key, so a
 *      retry either learns the first attempt landed or completes it.
 *   2. Otherwise delta = overageEvents - reportedEvents. If > 0 and worth at
 *      least the provider minimum, create a PENDING charge keyed
 *      "<periodId>:<overageEvents>", send it, then mark SENT and move the
 *      checkpoint in one transaction.
 *   3. A delta worth less than the minimum is WAIVED: the checkpoint moves
 *      with no transaction, because the provider would refuse the charge and
 *      a few cents are not worth carrying across periods.
 *
 * Downward corrections (late deletions) are never charged as negatives; the
 * checkpoint stays put and reconciliation shows the gap.
 */

export type ChargeRunSummary = {
  periods: number;
  sent: number;
  retried: number;
  zero: number;
  /** Overage worth less than the provider minimum: settled, never billed. */
  waived: number;
  failed: number;
  errors: { periodId: string; error: string }[];
};

type ChargeablePeriod = Prisma.BillingPeriodUsageGetPayload<{
  include: {
    subscription: {
      select: {
        id: true;
        status: true;
        providerSubscriptionId: true;
        plan: { select: { overagePricePer1k: true; currency: true } };
      };
    };
  };
}>;

/** Overage events not yet charged. Never negative. */
export const pendingDelta = (period: { overageEvents: bigint; reportedEvents: bigint }): number =>
  Number(period.overageEvents > period.reportedEvents ? period.overageEvents - period.reportedEvents : BigInt(0));

export const idempotencyKeyFor = (periodId: string, cumulativeAfter: bigint | number) =>
  `${periodId}:${cumulativeAfter.toString()}`;

/** Units billed for an event count: whole thousands, rounded up. */
export const unitsFor = (events: number) => Math.ceil(events / BILLING_CONFIG.usage.meterUnitEvents);

/** What a delta would cost, in cents. */
export const amountFor = (events: number, unitPriceCents: number) => unitsFor(events) * unitPriceCents;

/**
 * Whether the provider would refuse a charge this small. Paddle's floor is 70c
 * USD; anything under it is waived rather than retried forever.
 */
export const isBelowMinimumCharge = (amountCents: number) => amountCents < BILLING_CONFIG.usage.minChargeCents;

/** The line the customer reads on the invoice. */
export const chargeDescription = (period: { periodStart: Date; periodEnd: Date }, events: number) => {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  // The period end is exclusive, so the last day billed is the day before it.
  const lastDay = new Date(period.periodEnd.getTime() - 86_400_000);
  return `Extra events, ${day(period.periodStart)} to ${day(lastDay)} (${events.toLocaleString("en-US")} events)`;
};

/**
 * A period is charged only once it has closed: an open period is still
 * accruing, and charging it early would bill the customer several times a
 * month. Older than this and the provider will not accept it.
 */
const MAX_AGE_DAYS = 60;

export const chargeOverageForClosedPeriods = async (
  ctx: Pick<AppContext, "prisma">,
  provider: BillingProvider,
  now: Date = new Date(),
  /** Restrict to these subscriptions. Tests must pass it; cron passes nothing. */
  scope?: { subscriptionIds?: string[] },
): Promise<ChargeRunSummary> => {
  const { prisma } = ctx;
  const summary: ChargeRunSummary = { periods: 0, sent: 0, retried: 0, zero: 0, waived: 0, failed: 0, errors: [] };

  const since = new Date(now.getTime() - MAX_AGE_DAYS * 86_400_000);
  const candidates = await prisma.billingPeriodUsage.findMany({
    where: {
      ...(scope?.subscriptionIds ? { subscriptionId: { in: scope.subscriptionIds } } : {}),
      status: "CLOSED",
      periodEnd: { gte: since },
      subscription: {
        providerSubscriptionId: { not: null },
        status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"] },
        plan: { overagePricePer1k: { not: null } },
      },
    },
    include: {
      subscription: {
        select: {
          id: true,
          status: true,
          providerSubscriptionId: true,
          plan: { select: { overagePricePer1k: true, currency: true } },
        },
      },
    },
  });

  for (const period of candidates) {
    summary.periods += 1;
    try {
      const outcome = await chargePeriod(ctx, provider, period, now);
      summary[outcome] += 1;
    } catch (err) {
      summary.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ periodId: period.id, error: message });
      console.error(`[charge-overage] period ${period.id}: ${message}`);
    }
  }

  console.log(
    `[charge-overage] ${summary.periods} periods: ${summary.sent} charged, ${summary.retried} retried, ${summary.zero} zero, ${summary.waived} waived, ${summary.failed} failed`,
  );
  return summary;
};

export const chargePeriod = async (
  { prisma }: Pick<AppContext, "prisma">,
  provider: BillingProvider,
  period: ChargeablePeriod,
  now: Date,
): Promise<"sent" | "retried" | "zero" | "waived"> => {
  // 1. Finish anything in flight before computing a new delta.
  const unfinished = await prisma.usageRecord.findFirst({
    where: { billingPeriodUsageId: period.id, status: { in: ["PENDING", "FAILED"] } },
    orderBy: { createdAt: "asc" },
  });
  if (unfinished) {
    await send(prisma, provider, period, unfinished, now);
    return "retried";
  }

  // 2. New delta.
  const delta = pendingDelta(period);
  if (delta === 0) return "zero";

  const cumulativeAfter = period.overageEvents;
  const unitPriceCents = period.subscription.plan.overagePricePer1k;

  // 3. Too small to bill. Settle it as waived so the period stops coming back
  //    every hour and reconciliation sees a reason rather than a gap. The
  //    ledger keeps the events; only the money is forgone.
  if (unitPriceCents !== null && isBelowMinimumCharge(amountFor(delta, unitPriceCents))) {
    const amount = amountFor(delta, unitPriceCents);
    await prisma.$transaction([
      prisma.usageRecord.create({
        data: {
          subscriptionId: period.subscriptionId,
          billingPeriodUsageId: period.id,
          overageEvents: BigInt(delta),
          deltaEvents: BigInt(delta),
          cumulativeAfter,
          idempotencyKey: idempotencyKeyFor(period.id, cumulativeAfter),
          status: "WAIVED",
          attempts: 0,
          lastError: `${amount}c is under the provider minimum of ${BILLING_CONFIG.usage.minChargeCents}c; not billed`,
          provider: provider.name,
          reportedAt: now,
        },
      }),
      prisma.billingPeriodUsage.update({
        where: { id: period.id },
        data: { reportedEvents: cumulativeAfter, lastReportedAt: now },
      }),
    ]);
    console.log(`[charge-overage] period ${period.id}: waived ${delta} events (${amount}c, under the ${BILLING_CONFIG.usage.minChargeCents}c minimum)`);
    return "waived";
  }

  const record = await prisma.usageRecord.create({
    data: {
      subscriptionId: period.subscriptionId,
      billingPeriodUsageId: period.id,
      overageEvents: BigInt(delta),
      deltaEvents: BigInt(delta),
      cumulativeAfter,
      idempotencyKey: idempotencyKeyFor(period.id, cumulativeAfter),
      status: "PENDING",
      provider: provider.name,
    },
  });

  await send(prisma, provider, period, record, now);
  return "sent";
};

/**
 * Send one charge. Success advances the checkpoint atomically with the record.
 * Failure marks the record FAILED with the error and leaves the ledger and
 * checkpoint untouched; the next run retries the same record under the same
 * key, which is what stops a crash here from billing twice.
 */
const send = async (
  prisma: Pick<AppContext, "prisma">["prisma"],
  provider: BillingProvider,
  period: ChargeablePeriod,
  record: { id: string; deltaEvents: bigint | null; cumulativeAfter: bigint | null; idempotencyKey: string | null; attempts: number },
  now: Date,
) => {
  const events = Number(record.deltaEvents ?? 0);
  const cumulativeAfter = record.cumulativeAfter ?? BigInt(0);
  const key = record.idempotencyKey ?? idempotencyKeyFor(period.id, cumulativeAfter);
  const unitPriceCents = period.subscription.plan.overagePricePer1k;

  const fail = async (reason: string) => {
    await prisma.usageRecord.update({
      where: { id: record.id },
      data: { status: "FAILED", attempts: { increment: 1 }, lastError: reason.slice(0, 2000) },
    });
  };

  if (unitPriceCents === null) {
    // The plan stopped billing overage between accrual and charge. Never bill
    // for something the plan no longer sells.
    await fail("plan no longer bills overage; nothing charged");
    throw new Error(`period ${period.id} belongs to a plan with no overage price`);
  }

  // A record that was created before the minimum existed, or whose plan rate
  // dropped, may now be worth less than the provider will take. Retrying it
  // would fail every hour forever; settle it the way a new delta would be.
  const amount = amountFor(events, unitPriceCents);
  if (isBelowMinimumCharge(amount)) {
    await prisma.$transaction([
      prisma.usageRecord.update({
        where: { id: record.id },
        data: {
          status: "WAIVED",
          attempts: { increment: 1 },
          lastError: `${amount}c is under the provider minimum of ${BILLING_CONFIG.usage.minChargeCents}c; not billed`,
          reportedAt: now,
        },
      }),
      prisma.billingPeriodUsage.update({ where: { id: period.id }, data: { reportedEvents: cumulativeAfter, lastReportedAt: now } }),
    ]);
    console.log(`[charge-overage] period ${period.id}: waived a retried record of ${events} events (${amount}c)`);
    return;
  }

  const ageDays = (now.getTime() - period.periodEnd.getTime()) / 86_400_000;
  if (ageDays > MAX_AGE_DAYS - 1) {
    await fail(`period ended ${Math.floor(ageDays)} days ago; too old to charge automatically. Bill manually.`);
    throw new Error(`period ${period.id} too old to charge`);
  }

  try {
    const { transactionId } = await provider.chargeOverage({
      providerSubscriptionId: period.subscription.providerSubscriptionId as string,
      units: unitsFor(events),
      unitPriceCents,
      currency: period.subscription.plan.currency,
      description: chargeDescription(period, events),
      idempotencyKey: key,
    });

    await prisma.$transaction([
      prisma.usageRecord.update({
        where: { id: record.id },
        data: {
          status: "SENT",
          attempts: { increment: 1 },
          lastError: null,
          reportedAt: now,
          providerTransactionId: transactionId,
        },
      }),
      prisma.billingPeriodUsage.update({
        where: { id: period.id },
        // The checkpoint is the record's cumulative, not the period's current
        // overage, so a retry of an older record cannot skip ahead.
        data: { reportedEvents: cumulativeAfter, lastReportedAt: now },
      }),
    ]);

    console.log(
      `[charge-overage] period ${period.id}: charged ${unitsFor(events)} unit(s) for ${events} events (cumulative ${cumulativeAfter})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await fail(message);
    throw err;
  }
};
