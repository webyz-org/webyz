import type { AppContext } from "../../../lib/context.js";
import { BILLING_CONFIG } from "../catalog/billing.config.js";
import type { BillingProvider } from "../provider/billing-provider.js";

/**
 * Three-way reconciliation for closed usage periods on pay-as-you-go
 * subscriptions:
 *
 *   ledger (overage_events) == checkpoint (reported_events)
 *                           == the charge transaction at the provider
 *                           == the units and amount on its invoice line
 *
 * The ledger is authoritative. Nothing here writes; differences are returned
 * for a human to act on through the provider (credit note or re-bill).
 *
 * The provider states units, never raw events: it has no meter, the charge is
 * built from our own arithmetic. So the events figure is checked against the
 * checkpoint, and the units and money are checked against the transaction.
 */

export type PeriodReconciliation = {
  periodId: string;
  subscriptionId: string;
  userEmail: string;
  periodStart: Date;
  periodEnd: Date;
  ledgerOverage: number;
  reportedEvents: number;
  /** The charge we recorded sending, and its provider transaction. */
  chargedEvents: number | null;
  /** Overage settled without a charge because it was under the provider minimum. */
  waivedEvents: number;
  transactionId: string | null;
  transactionStatus: string | null;
  invoiceId: string | null;
  invoiceUnits: number | null;
  invoiceAmountCents: number | null;
  expectedUnits: number;
  expectedAmountCents: number | null;
  baseChargedOnUsageInvoice: boolean;
  findings: string[];
};

export type ReconciliationFinding = PeriodReconciliation["findings"][number];

/** Pure: compare the figures for one period and name every difference. */
export const compareFigures = (input: {
  ledgerOverage: number;
  reportedEvents: number;
  chargedEvents: number | null;
  waivedEvents?: number;
  transactionStatus: string | null;
  invoiceUnits: number | null;
  invoiceAmountCents: number | null;
  overagePricePer1k: number | null;
  billingCycle: "MONTHLY" | "YEARLY";
  hasBaseLine: boolean;
  invoiceExpected: boolean;
}): { findings: string[]; expectedUnits: number; expectedAmountCents: number | null } => {
  const findings: string[] = [];
  const unit = BILLING_CONFIG.usage.meterUnitEvents;
  // Units expected on an invoice: only what was charged, never what was waived.
  const waived = input.waivedEvents ?? 0;
  const expectedUnits = Math.ceil(Math.max(0, input.ledgerOverage - waived) / unit);
  const expectedAmountCents = input.overagePricePer1k === null ? null : expectedUnits * input.overagePricePer1k;

  if (input.reportedEvents < input.ledgerOverage) findings.push(`under-charged: ledger ${input.ledgerOverage}, charged ${input.reportedEvents}`);
  if (input.reportedEvents > input.ledgerOverage) findings.push(`over-charged: ledger ${input.ledgerOverage}, charged ${input.reportedEvents} (late downward correction)`);
  // The checkpoint is explained by charges plus waivers, nothing else.
  const settled = (input.chargedEvents ?? 0) + waived;
  if ((input.chargedEvents !== null || waived > 0) && settled !== input.reportedEvents) {
    findings.push(`charge records total ${input.chargedEvents ?? 0} plus ${waived} waived, checkpoint ${input.reportedEvents}`);
  }
  if (input.reportedEvents > 0 && input.chargedEvents === null && waived === 0) findings.push("checkpoint moved with no charge record");
  if (input.transactionStatus !== null && !["billed", "paid", "completed"].includes(input.transactionStatus)) {
    findings.push(`charge transaction is ${input.transactionStatus}`);
  }
  if (input.invoiceExpected && (input.chargedEvents ?? 0) > 0 && input.invoiceUnits === null) {
    findings.push("no usage line recorded for this period");
  }
  if (input.invoiceUnits !== null && input.invoiceUnits !== expectedUnits) {
    findings.push(`invoice units ${input.invoiceUnits} differ from expected ${expectedUnits}`);
  }
  if (input.invoiceAmountCents !== null && expectedAmountCents !== null && input.invoiceAmountCents !== expectedAmountCents) {
    findings.push(`invoice amount ${input.invoiceAmountCents}c differs from expected ${expectedAmountCents}c`);
  }
  if (input.billingCycle === "YEARLY" && input.hasBaseLine) findings.push("annual customer: base line present on a usage invoice");
  return { findings, expectedUnits, expectedAmountCents };
};

export const reconcileClosedPeriods = async (
  { prisma }: Pick<AppContext, "prisma">,
  provider: BillingProvider | null,
  opts: { sinceDays?: number; now?: Date } = {},
): Promise<PeriodReconciliation[]> => {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.sinceDays ?? 35) * 86_400_000);

  const periods = await prisma.billingPeriodUsage.findMany({
    where: {
      status: "CLOSED",
      periodEnd: { gte: since },
      subscription: { providerSubscriptionId: { not: null }, plan: { overagePricePer1k: { not: null } } },
    },
    include: {
      usageRecords: { where: { status: { in: ["SENT", "WAIVED"] } }, select: { status: true, deltaEvents: true, cumulativeAfter: true, providerTransactionId: true } },
      subscription: {
        select: {
          id: true,
          billingCycle: true,
          plan: { select: { overagePricePer1k: true } },
          user: { select: { email: true } },
          invoices: {
            where: { hasUsageLine: true },
            select: { providerInvoiceId: true, usageUnits: true, usagePeriodStart: true, usagePeriodEnd: true, hasBaseLine: true, lines: true },
          },
        },
      },
    },
    orderBy: { periodEnd: "asc" },
  });

  const out: PeriodReconciliation[] = [];
  for (const p of periods) {
    const sub = p.subscription;
    const sent = p.usageRecords.filter((r) => r.status === "SENT");
    const charge = sent.at(-1) ?? null;
    const chargedEvents = sent.length ? Number(sent.reduce((acc, r) => acc + (r.deltaEvents ?? BigInt(0)), BigInt(0))) : null;
    const waivedEvents = Number(
      p.usageRecords.filter((r) => r.status === "WAIVED").reduce((acc, r) => acc + (r.deltaEvents ?? BigInt(0)), BigInt(0)),
    );

    // Match the invoice by the transaction the charge created; fall back to the
    // usage line whose period matches, for charges made before that was recorded.
    const invoice =
      sub.invoices.find((i) => charge?.providerTransactionId && i.providerInvoiceId === charge.providerTransactionId) ??
      sub.invoices.find((i) => i.usagePeriodStart && Math.abs(i.usagePeriodStart.getTime() - p.periodStart.getTime()) < 3_600_000) ??
      null;
    const usageAmount = invoice
      ? (invoice.lines as { kind: string; amountCents: number }[]).filter((l) => l.kind === "usage").reduce((a, l) => a + l.amountCents, 0)
      : null;

    let transactionStatus: string | null = null;
    if (provider && charge?.providerTransactionId) {
      try {
        transactionStatus = (await provider.getTransaction(charge.providerTransactionId)).status;
      } catch (err) {
        console.warn(`[reconcile] transaction lookup failed for ${p.id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    const cmp = compareFigures({
      ledgerOverage: Number(p.overageEvents),
      reportedEvents: Number(p.reportedEvents),
      chargedEvents,
      waivedEvents,
      transactionStatus,
      invoiceUnits: invoice?.usageUnits ?? null,
      invoiceAmountCents: usageAmount,
      overagePricePer1k: sub.plan.overagePricePer1k,
      billingCycle: sub.billingCycle,
      hasBaseLine: invoice?.hasBaseLine ?? false,
      // The charge raises its own transaction immediately, so an hour after the
      // period closed there should be one. A waived period has none, by design.
      invoiceExpected: chargedEvents !== null && chargedEvents > 0 && now.getTime() - p.periodEnd.getTime() > 3_600_000,
    });

    out.push({
      periodId: p.id,
      subscriptionId: sub.id,
      userEmail: sub.user.email,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      ledgerOverage: Number(p.overageEvents),
      reportedEvents: Number(p.reportedEvents),
      chargedEvents,
      waivedEvents,
      transactionId: charge?.providerTransactionId ?? null,
      transactionStatus,
      invoiceId: invoice?.providerInvoiceId ?? null,
      invoiceUnits: invoice?.usageUnits ?? null,
      invoiceAmountCents: usageAmount,
      expectedUnits: cmp.expectedUnits,
      expectedAmountCents: cmp.expectedAmountCents,
      baseChargedOnUsageInvoice: sub.billingCycle === "YEARLY" && (invoice?.hasBaseLine ?? false),
      findings: cmp.findings,
    });
  }
  return out;
};
