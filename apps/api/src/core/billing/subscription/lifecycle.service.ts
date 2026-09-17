import type { AppContext } from "../../../lib/context.js";
import { Prisma, type SubscriptionStatus } from "../../../generated/prisma/client.js";
import { BILLING_CONFIG } from "../catalog/billing.config.js";
import { invalidateEntitlements } from "../entitlements/entitlement.service.js";
import { assignFreePlan } from "../free-plan.service.js";
import { notifyOnce } from "../notifications/notification.service.js";
import { reconcileRestriction } from "../state/restriction.service.js";
import { reconcileSitesToLimit } from "./site-limit.service.js";
import { closeOpenPeriods } from "../usage/aggregation.service.js";
import { paymentFailedEmail, paymentRecoveredEmail, planChangedEmail } from "../../email/templates/index.js";
import type {
  BillingProvider,
  ProviderInvoice,
  ProviderInvoiceLine,
  ProviderSubscription,
} from "../provider/billing-provider.js";
import { baseItemOf, deriveBasePeriod, deriveBillingCycle, deriveUsagePeriod } from "./periods.js";

/**
 * Provider-agnostic subscription lifecycle. Webhook adapters translate vendor
 * events into these calls; every function here is idempotent and writes the
 * current state of the provider object rather than applying a transition, so
 * duplicate and out-of-order deliveries converge on the same row.
 */

export type SubscriptionMeta = Partial<Record<"userId" | "planId" | "billingCycle", string>>;

/** A deferred plan change this row will move to at `effectiveAt`. */
export type PendingChange = { planId: string; billingCycle: "MONTHLY" | "YEARLY"; effectiveAt: Date };

export const mapProviderStatus = (status: ProviderSubscription["status"]): SubscriptionStatus => {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
      return "PAST_DUE";
    // A paused subscription bills nothing and grants nothing. Webyz never
    // pauses one itself, so this only happens from the provider dashboard.
    case "paused":
    case "canceled":
      return "CANCELED";
  }
};

const LIVE: SubscriptionStatus[] = ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"];

/**
 * Bring the local row in line with the provider subscription.
 *
 * Handles creation, updates and renewals. The plan comes from the recurring
 * item's price, except while a deferred downgrade is pending: the provider
 * already carries the new price then (it bills it from the next renewal), but
 * the customer keeps the plan they paid for until `pendingChangeAt`, so the
 * local plan is pinned until that moment passes.
 */
export const syncSubscription = async (
  ctx: AppContext,
  _provider: BillingProvider,
  incoming: ProviderSubscription,
  hint?: SubscriptionMeta,
  opts: { now?: Date } = {},
): Promise<void> => {
  const { prisma } = ctx;
  const sub = incoming;
  const now = opts.now ?? new Date();
  const meta: SubscriptionMeta = { ...sub.metadata, ...(hint ?? {}) };

  const existing = await prisma.subscription.findUnique({
    where: { providerSubscriptionId: sub.id },
    select: {
      id: true,
      userId: true,
      planId: true,
      restriction: true,
      status: true,
      graceEndsAt: true,
      billingCycle: true,
      pendingPlanId: true,
      pendingBillingCycle: true,
      pendingChangeAt: true,
      plan: { select: { name: true } },
    },
  });

  // Owner: metadata, then the customer id.
  let userId = existing?.userId ?? meta.userId ?? null;
  if (!userId) {
    const user = await prisma.user.findUnique({
      where: { providerCustomerId: sub.customerId },
      select: { id: true },
    });
    userId = user?.id ?? null;
  }
  if (!userId) {
    console.warn(`[subscription] ${sub.id}: cannot resolve owner, skipping`);
    return;
  }

  // The subscription's customer is the truth for the portal and the invoice
  // list. It can differ from the one we created at checkout: Paddle matches
  // customers by the email typed into the overlay, so a customer who enters a
  // different address gets a second customer record, and everything they paid
  // for lives under it. Follow the money.
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { providerCustomerId: true } });
  if (owner && owner.providerCustomerId !== sub.customerId) {
    // The unique index means another user may already hold this customer id;
    // that would be two accounts sharing one Paddle customer, which is worth
    // knowing about but must not break the sync.
    try {
      await prisma.user.update({ where: { id: userId }, data: { providerCustomerId: sub.customerId } });
      console.log(`[subscription] ${sub.id}: user ${userId} now maps to provider customer ${sub.customerId} (was ${owner.providerCustomerId ?? "none"})`);
    } catch (err) {
      console.error(`[subscription] ANOMALY ${sub.id}: provider customer ${sub.customerId} is already attached to another user; user ${userId} keeps ${owner.providerCustomerId}`, err);
    }
  }

  // A deferred downgrade still to come: the provider is already on the new
  // price but nothing has been billed for it yet.
  const pendingPinned =
    existing !== null &&
    existing.pendingPlanId !== null &&
    existing.pendingChangeAt !== null &&
    existing.pendingChangeAt > now;

  // Plan: the recurring item's price is the truth; metadata is the fallback.
  const base = baseItemOf(sub.items);
  let plan = base
    ? await prisma.plan.findFirst({
        where: { OR: [{ providerPriceMonthlyId: base.priceId }, { providerPriceYearlyId: base.priceId }] },
        select: { id: true, overagePricePer1k: true },
      })
    : null;
  const fallbackPlanId = meta.planId ?? existing?.planId;
  if (!plan && fallbackPlanId) {
    plan = await prisma.plan.findUnique({
      where: { id: fallbackPlanId },
      select: { id: true, overagePricePer1k: true },
    });
  }
  if (!plan) {
    console.warn(`[subscription] ${sub.id}: cannot resolve plan, skipping`);
    return;
  }

  const providerPlanId = plan.id;
  const providerCycle = deriveBillingCycle(sub.items);
  if (pendingPinned && existing) {
    // Keep what the customer paid for until the pending change is due.
    plan = { id: existing.planId, overagePricePer1k: plan.overagePricePer1k };
  } else if (existing?.pendingPlanId && existing.pendingPlanId !== providerPlanId) {
    // The pending change is due but the provider is not on the plan it named.
    // Money decides: follow the provider and say so loudly, because either the
    // deferred change never reached the provider or someone changed it there.
    console.error(
      `[subscription] ANOMALY ${sub.id}: pending plan ${existing.pendingPlanId} due, provider is on ${providerPlanId}; following the provider`,
    );
  }
  const billingCycle = pendingPinned && existing ? existing.billingCycle : providerCycle;

  const basePeriod = deriveBasePeriod(sub);
  const usage = deriveUsagePeriod(basePeriod, billingCycle, now);
  const status = mapProviderStatus(sub.status);
  const isLive = LIVE.includes(status);

  // Grace follows the provider status as well as the payment_failed event, so
  // a renewal that goes past due without a webhook we handled still opens
  // exactly one grace window.
  const inArrears = status === "PAST_DUE" || status === "UNPAID";
  const graceEndsAt = inArrears
    ? existing?.graceEndsAt ?? new Date(now.getTime() + BILLING_CONFIG.payment.graceDays * 86_400_000)
    : null;

  const planChanged = existing !== null && (existing.planId !== plan.id || existing.billingCycle !== billingCycle);
  // A pending change is over once it is due: it either applied (the provider
  // moved to the pending plan) or it did not, and the anomaly above said so.
  const pendingData = pendingPinned
    ? {}
    : { pendingPlanId: null, pendingBillingCycle: null, pendingChangeAt: null };

  const data = {
    graceEndsAt,
    userId,
    planId: plan.id,
    status,
    billingCycle,
    ...pendingData,
    providerSubscriptionId: sub.id,
    currentPeriodStart: usage?.start ?? null,
    currentPeriodEnd: usage?.end ?? null,
    basePeriodStart: basePeriod?.start ?? null,
    basePeriodEnd: basePeriod?.end ?? null,
    cancelAt: sub.cancelAt,
    cancelAtPeriodEnd: sub.cancelAt !== null,
    canceledAt: sub.canceledAt,
  };

  // Rows this call retires, closed outside the transaction below.
  const retiredIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    const row = existing
      ? await tx.subscription.update({ where: { id: existing.id }, data })
      : await tx.subscription.create({ data });

    if (!isLive) return;

    // One live subscription per user: the free or trial row this replaces is
    // retired. An incomplete checkout never reaches here, so a failed first
    // payment leaves the customer exactly where they were.
    const retiring = await tx.subscription.findMany({
      where: { userId, id: { not: row.id }, status: { in: LIVE } },
      select: { id: true, providerSubscriptionId: true },
    });
    retiredIds.push(...retiring.map((r) => r.id));
    const displaced = retiring.filter((r) => r.providerSubscriptionId !== null);
    await tx.subscription.updateMany({
      where: { userId, id: { not: row.id }, status: { in: LIVE } },
      data: { status: "CANCELED", canceledAt: new Date() },
    });
    // Retiring a local row does not cancel anything at the provider. Two live
    // provider subscriptions for one account means the customer is being
    // billed twice, which nothing here may resolve on its own: it needs a
    // refund decision. Say so where monitoring will see it.
    for (const d of displaced) {
      console.error(
        `[subscription] ANOMALY ${sub.id}: user ${userId} also has live provider subscription ${d.providerSubscriptionId}; cancel one at the provider and refund`,
      );
    }
  });

  // A retired row is never visited by the usage sync again, so settle its
  // open period now rather than leave it frozen and unchargeable. Wall time,
  // not `now`: `now` is the provider event's own timestamp, which is right for
  // judging whether a deferred change is due but wrong here, because a
  // redelivered webhook would back-date the close and clip the final
  // aggregation to an hour that has long since passed.
  for (const id of retiredIds) await closeOpenPeriods(ctx, id);

  // Status and grace changed above; the restriction decision follows from them
  // together with the cap and quota facts (state/restriction.ts).
  await reconcileRestriction(ctx, userId, now);
  await invalidateEntitlements(ctx, userId);

  // Plan changed: fewer sites may be allowed (downgrade took effect) or more
  // (upgrade). Reconcile without deleting, tell the customer once per change.
  if (planChanged && isLive) {
    const { restricted } = await reconcileSitesToLimit(ctx, userId, "PLAN_CHANGE");
    const [user, toPlan] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true } }),
      prisma.plan.findUniqueOrThrow({ where: { id: plan.id }, select: { name: true } }),
    ]);
    const row = await prisma.subscription.findUniqueOrThrow({ where: { providerSubscriptionId: sub.id }, select: { id: true } });
    await notifyOnce(ctx, {
      subscriptionId: row.id,
      kind: "subscription_changed",
      scopeKey: `applied:${plan.id}:${billingCycle}:${usage?.start.toISOString() ?? ""}`,
      message: planChangedEmail(user.email, {
        name: user.name,
        fromPlan: existing!.plan.name,
        toPlan: toPlan.name,
        toCycle: billingCycle,
        restrictedSites: restricted.map((w) => w.domain),
      }),
    });
  }

  console.log(
    `[subscription] ${sub.id} ${existing ? "updated" : "created"} for user ${userId}: ${status}, ` +
      `cycle ${data.billingCycle}, usage ${usage?.start.toISOString().slice(0, 10)}..${usage?.end.toISOString().slice(0, 10)}`,
  );
};

/** The provider says the subscription is over: back to the free plan. */
export const endSubscription = async (ctx: AppContext, providerSubscriptionId: string) => {
  const { prisma } = ctx;
  const sub = await prisma.subscription.findUnique({
    where: { providerSubscriptionId: providerSubscriptionId },
    select: { id: true, userId: true, status: true },
  });
  if (!sub) {
    console.warn(`[subscription] ended ${providerSubscriptionId}: no local row`);
    return;
  }
  // Close the final period before the row stops being live, so the last
  // stretch of usage is aggregated and settled rather than frozen OPEN on a
  // subscription nothing visits again.
  await closeOpenPeriods(ctx, sub.id);
  if (sub.status !== "CANCELED") {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: "CANCELED", canceledAt: new Date(), restriction: "NONE", restrictedAt: null },
    });
  }
  await assignFreePlan({ prisma }, sub.userId);
  // The free row that replaces it has a fresh allowance: sites blocked for
  // non-payment come back on.
  await reconcileRestriction(ctx, sub.userId);
  await invalidateEntitlements(ctx, sub.userId);
  const { restricted } = await reconcileSitesToLimit(ctx, sub.userId, "PLAN_CHANGE");
  console.log(`[subscription] ${providerSubscriptionId} ended, user ${sub.userId} back on free; ${restricted.length} site(s) made inactive`);
};

/**
 * A payment failed. Opens the grace window once; retries do not extend it.
 * Nothing is revoked here: for an annual customer a failed monthly overage
 * invoice must not touch the prepaid year. The enforcement job restricts
 * ingest only when graceEndsAt passes.
 */
export const markPaymentFailed = async (ctx: AppContext, providerSubscriptionId: string, now = new Date()) => {
  const sub = await ctx.prisma.subscription.findUnique({
    where: { providerSubscriptionId: providerSubscriptionId },
    select: { id: true, userId: true, graceEndsAt: true, status: true, plan: { select: { name: true } }, user: { select: { email: true, name: true } } },
  });
  if (!sub) return;
  const graceEndsAt = sub.graceEndsAt ?? new Date(now.getTime() + BILLING_CONFIG.payment.graceDays * 86_400_000);
  await ctx.prisma.subscription.update({
    where: { id: sub.id },
    data: { status: sub.status === "UNPAID" ? "UNPAID" : "PAST_DUE", graceEndsAt },
  });
  // Inside the grace window this changes nothing; an UNPAID row, or a grace
  // window that has already lapsed, is restricted here and now. `now` above is
  // the event time (it anchors the grace window); the decision is always made
  // at wall time, so a late delivery cannot judge a lapsed grace as running.
  await reconcileRestriction(ctx, sub.userId);
  await invalidateEntitlements(ctx, sub.userId);
  await notifyOnce(ctx, {
    subscriptionId: sub.id,
    kind: "payment_failed",
    scopeKey: graceEndsAt.toISOString(),
    message: paymentFailedEmail(sub.user.email, { name: sub.user.name, planName: sub.plan.name, graceEndsAt }),
  });
  console.log(`[subscription] payment failed for ${providerSubscriptionId}, grace until ${graceEndsAt.toISOString()}`);
};

/**
 * A paid invoice closes any grace window. The payment restriction lifts with
 * it, unless the spending cap or the quota still holds (state/restriction.ts).
 */
export const markPaymentSucceeded = async (ctx: AppContext, providerSubscriptionId: string) => {
  const sub = await ctx.prisma.subscription.findUnique({
    where: { providerSubscriptionId: providerSubscriptionId },
    select: { id: true, userId: true, status: true, graceEndsAt: true, plan: { select: { name: true } }, user: { select: { email: true, name: true } } },
  });
  if (!sub) return;
  const wasInArrears = sub.status === "PAST_DUE" || sub.status === "UNPAID";
  await ctx.prisma.subscription.update({
    where: { id: sub.id },
    data: {
      ...(wasInArrears ? { status: "ACTIVE" as const } : {}),
      graceEndsAt: null,
    },
  });
  await reconcileRestriction(ctx, sub.userId);
  await invalidateEntitlements(ctx, sub.userId);
  if (wasInArrears) {
    await notifyOnce(ctx, {
      subscriptionId: sub.id,
      kind: "payment_recovered",
      scopeKey: sub.graceEndsAt?.toISOString() ?? "no-grace",
      message: paymentRecoveredEmail(sub.user.email, { name: sub.user.name, planName: sub.plan.name }),
    });
  }
};

/**
 * Grace is over: restrict ingest for subscriptions still unpaid past their
 * grace deadline. Dashboards stay open, nothing is deleted, the subscription
 * itself is left to the provider. Idempotent: rows already restricted for
 * non-payment are skipped; rows restricted for another reason (spend cap,
 * quota) are re-evaluated so non-payment takes precedence. Returns the
 * subscription ids newly restricted for non-payment this run.
 */
export const expirePaymentGrace = async (ctx: AppContext, now = new Date()): Promise<string[]> => {
  const { prisma } = ctx;
  const due = await prisma.subscription.findMany({
    where: {
      restriction: { not: "PAYMENT_FAILED" },
      OR: [{ status: "UNPAID" }, { status: "PAST_DUE", graceEndsAt: { lte: now } }],
    },
    select: { id: true, userId: true },
  });

  const restricted: string[] = [];
  for (const sub of due) {
    const result = await reconcileRestriction(ctx, sub.userId, now);
    if (result.subscriptionId === sub.id && result.decision.restriction === "PAYMENT_FAILED" && result.previous !== "PAYMENT_FAILED") {
      restricted.push(sub.id);
      console.log(`[subscription] ${sub.id}: payment grace expired, ingest restricted`);
    }
  }
  return restricted;
};

// ─── Invoices ────────────────────────────────────────────────────────────────

export type ClassifiedLine = ProviderInvoiceLine & { kind: "base" | "usage" | "other" };

/**
 * Classify invoice lines against the plan's own price ids: a line billing one
 * of them is "base". A line the provider already knows is overage (it carries
 * the charge key we stamped) stays "usage".
 */
export const classifyLines = (
  lines: ProviderInvoiceLine[],
  plan: { basePriceIds: (string | null)[] },
): ClassifiedLine[] => {
  const basePriceIds = plan.basePriceIds.filter((id): id is string => id !== null);
  return lines.map((line) => {
    if (line.kind === "usage") return line as ClassifiedLine;
    if (line.priceId && basePriceIds.includes(line.priceId)) return { ...line, kind: "base" };
    return line as ClassifiedLine;
  });
};

/**
 * Anomaly check for annual customers: a renewal invoice that carries a base
 * line before the base period has ended means the annual price was charged
 * again mid-year. Never silently accepted.
 */
export const baseChargedEarly = (
  classified: ClassifiedLine[],
  invoice: { billingReason: string | null; createdAt: Date },
  basePeriod: { start: Date | null; end: Date | null },
): boolean => {
  if (invoice.billingReason !== "subscription_recurring" || !basePeriod.start || !basePeriod.end) return false;
  const baseLine = classified.find((l) => l.kind === "base");
  if (!baseLine?.periodStart) return false;
  // A legitimate renewal's base line starts exactly at a base period boundary,
  // whichever side of the roll the local row is on when the webhook lands
  // (webhooks are unordered). A line whose period starts strictly inside the
  // current base period is a base charge in the middle of a prepaid term.
  const tolerance = 60_000;
  const start = baseLine.periodStart.getTime();
  return start > basePeriod.start.getTime() + tolerance && start < basePeriod.end.getTime() - tolerance;
};

/** Record a provider invoice with classified lines for reconciliation. */
export const recordInvoice = async (ctx: AppContext, invoice: ProviderInvoice) => {
  const { prisma } = ctx;
  const sub = invoice.providerSubscriptionId
    ? await prisma.subscription.findUnique({
        where: { providerSubscriptionId: invoice.providerSubscriptionId },
        select: {
          id: true,
          basePeriodStart: true,
          basePeriodEnd: true,
          plan: { select: { providerPriceMonthlyId: true, providerPriceYearlyId: true } },
        },
      })
    : null;

  const classified = classifyLines(invoice.lines, {
    basePriceIds: [sub?.plan.providerPriceMonthlyId ?? null, sub?.plan.providerPriceYearlyId ?? null],
  });
  const usageLines = classified.filter((l) => l.kind === "usage");
  // The provider states units, not events: an overage line's quantity is
  // ceil(events / 1,000), which is what reconciliation compares. The raw event
  // count exists only in our ledger.
  const usageUnits = usageLines.length ? usageLines.reduce((acc, l) => acc + (l.quantity ?? 0), 0) : null;
  const usageStart = usageLines.map((l) => l.periodStart).filter((d): d is Date => d !== null);
  const usageEnd = usageLines.map((l) => l.periodEnd).filter((d): d is Date => d !== null);

  if (sub && baseChargedEarly(classified, invoice, { start: sub.basePeriodStart, end: sub.basePeriodEnd })) {
    console.error(
      `[invoice] ANOMALY ${invoice.id}: base line on a renewal before base period end ${sub.basePeriodEnd?.toISOString()}`,
    );
  }

  const data = {
    provider: "paddle",
    providerInvoiceId: invoice.id,
    subscriptionId: sub?.id ?? null,
    status: invoice.status,
    billingReason: invoice.billingReason,
    currency: invoice.currency,
    subtotalCents: invoice.subtotalCents,
    totalCents: invoice.totalCents,
    amountPaidCents: invoice.amountPaidCents,
    lines: classified as unknown as Prisma.InputJsonValue,
    hasBaseLine: classified.some((l) => l.kind === "base"),
    hasUsageLine: usageLines.length > 0,
    usageQuantity: null,
    usageUnits,
    usagePeriodStart: usageStart.length ? new Date(Math.min(...usageStart.map((d) => d.getTime()))) : null,
    usagePeriodEnd: usageEnd.length ? new Date(Math.max(...usageEnd.map((d) => d.getTime()))) : null,
    finalizedAt: invoice.billedAt,
    paidAt: invoice.paidAt,
  };

  return prisma.billingInvoice.upsert({
    where: { providerInvoiceId: invoice.id },
    update: data,
    create: data,
  });
};
