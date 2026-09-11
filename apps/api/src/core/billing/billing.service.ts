import type { AppContext } from "../../lib/context.js";
import { FRONTEND_URL } from "../../config/env.js";
import { badRequest, notFound } from "../../errors/http-errors.js";
import type { BillingProvider } from "./provider/billing-provider.js";
import { hasBillingProvider } from "./provider/index.js";
import { syncSubscription } from "./subscription/lifecycle.service.js";
import { resolvePrices } from "./subscription/prices.js";
import { requestPlanChange } from "./subscription/plan-change.service.js";
import { notifyOnce } from "./notifications/notification.service.js";
import { cancellationScheduledEmail } from "../email/templates/index.js";

export { resolvePrices };

/**
 * Customer-initiated billing actions. Everything goes through the
 * BillingProvider; nothing here knows which provider it is. Expected failures
 * are operational errors so the billing page can show the reason.
 */

const LIVE = ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"] as const;

const requireBilling = () => {
  if (!hasBillingProvider()) throw badRequest("Billing is not enabled on this server yet.");
};

export const startCheckout = async (
  ctx: AppContext,
  provider: BillingProvider,
  userId: string,
  planId: string,
  billingCycle: "MONTHLY" | "YEARLY" = "MONTHLY",
) => {
  requireBilling();
  const { prisma } = ctx;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("User not found");

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw notFound("Plan not found");
  const { basePriceId } = resolvePrices(plan, billingCycle);

  // Only one paid subscription at a time. The free or trial row is retired by
  // the subscription webhook.
  const existingPaid = await prisma.subscription.findFirst({
    where: { userId, status: { in: [...LIVE] }, providerSubscriptionId: { not: null } },
  });
  if (existingPaid) {
    throw badRequest("You already have a paid subscription. Change plans from the billing page instead.");
  }

  let customerId = user.providerCustomerId;
  if (!customerId) {
    const created = await provider.createCustomer({ email: user.email, name: user.name ?? undefined, userId: user.id });
    customerId = created.customerId;
    await prisma.user.update({ where: { id: userId }, data: { providerCustomerId: customerId } });
  }

  return provider.startCheckout({
    customerId,
    basePriceId,
    metadata: { userId: user.id, planId: plan.id, billingCycle },
    successUrl: `${FRONTEND_URL}/settings/billing?payment=success`,
  });
};

export const createBillingPortal = async (ctx: AppContext, provider: BillingProvider, userId: string) => {
  requireBilling();
  const user = await ctx.prisma.user.findUnique({ where: { id: userId } });
  if (!user?.providerCustomerId) throw badRequest("No billing account yet. Choose a paid plan first.");
  // The portal manages the customer's live subscriptions, so it needs their
  // ids: without them it opens on an overview with nothing to act on.
  const subs = await ctx.prisma.subscription.findMany({
    where: { userId, status: { in: [...LIVE] }, providerSubscriptionId: { not: null } },
    select: { providerSubscriptionId: true },
  });
  const { url } = await provider.createPortalSession({
    customerId: user.providerCustomerId,
    subscriptionIds: subs.map((s) => s.providerSubscriptionId as string),
    returnUrl: `${FRONTEND_URL}/settings/billing`,
  });
  return url;
};

/**
 * Cancel at the end of what the customer has paid for. For annual plans that
 * is the end of the prepaid year, and the monthly metered item stops with it.
 * Access continues until then; data is never touched.
 */
export const cancelSubscription = async (ctx: AppContext, provider: BillingProvider, userId: string) => {
  requireBilling();
  const sub = await getPaidSubscription(ctx, userId);
  const updated = await provider.scheduleCancellation(sub.providerSubscriptionId);
  await syncSubscription(ctx, provider, updated);
  if (updated.cancelAt) {
    const [user, plan, free] = await Promise.all([
      ctx.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true } }),
      ctx.prisma.plan.findUniqueOrThrow({ where: { id: sub.planId }, select: { name: true } }),
      ctx.prisma.plan.findFirstOrThrow({ where: { isFree: true }, select: { name: true } }),
    ]);
    await notifyOnce(ctx, {
      subscriptionId: sub.id,
      kind: "subscription_canceled",
      scopeKey: updated.cancelAt.toISOString(),
      message: cancellationScheduledEmail(user.email, { name: user.name, planName: plan.name, accessUntil: updated.cancelAt, fallbackPlan: free.name }),
    });
  }
  return { canceledAt: updated.cancelAt };
};

export const resumeSubscription = async (ctx: AppContext, provider: BillingProvider, userId: string) => {
  requireBilling();
  const sub = await getPaidSubscription(ctx, userId);
  const updated = await provider.resumeSubscription(sub.providerSubscriptionId);
  await syncSubscription(ctx, provider, updated);
  return { resumed: updated.cancelAt === null };
};

/**
 * Plan or cycle change. Upgrades apply now with proration; downgrades are
 * scheduled for the end of the paid period. See subscription/plan-change.service.ts.
 */
export const changePlan = (
  ctx: AppContext,
  provider: BillingProvider,
  userId: string,
  input: { planId: string; billingCycle: "MONTHLY" | "YEARLY" },
) => {
  requireBilling();
  return requestPlanChange(ctx, provider, userId, input);
};

export const getMySubscription = async ({ prisma }: AppContext, userId: string) =>
  prisma.subscription.findFirst({
    where: { userId, status: { in: [...LIVE] } },
    orderBy: { createdAt: "desc" },
    include: {
      plan: true,
      billingPeriodUsages: { orderBy: { periodStart: "desc" }, take: 1 },
    },
  });

const getPaidSubscription = async ({ prisma }: AppContext, userId: string) => {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: { in: [...LIVE] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, planId: true, billingCycle: true, providerSubscriptionId: true },
  });
  if (!sub) throw notFound("No active subscription found");
  if (!sub.providerSubscriptionId) throw badRequest("The free plan has no paid subscription to change.");
  return { ...sub, providerSubscriptionId: sub.providerSubscriptionId };
};
