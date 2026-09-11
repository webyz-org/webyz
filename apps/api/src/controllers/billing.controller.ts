import { FastifyReply, FastifyRequest } from "fastify";

import { sendResponse } from "../http/helper/send-response.js";
import { badRequest, forbidden, notFound } from "../errors/http-errors.js";
import { PADDLE_ENVIRONMENT, PADDLE_IP_ALLOWLIST, PADDLE_WEBHOOK_SECRET } from "../config/env.js";
import { isKnownPaddleIp } from "../core/billing/provider/paddle-ips.js";
import {
  cancelSubscription,
  changePlan,
  createBillingPortal,
  startCheckout,
  getMySubscription,
  resumeSubscription,
} from "../core/billing/billing.service.js";
import { getBillingProvider, hasBillingProvider } from "../core/billing/provider/index.js";
import { processWebhookEvent } from "../core/billing/webhooks/webhook.service.js";
import { getUsageSummary } from "../core/billing/usage/usage.service.js";
import { setSpendCap } from "../core/billing/spend-cap/spend-cap.service.js";
import { cancelPendingChange, previewCancellation, previewPlanChange } from "../core/billing/subscription/plan-change.service.js";

/** The customer's invoices from the provider, newest first, with hosted links. */
export const invoicesController = async (request: FastifyRequest, reply: FastifyReply) => {
  const user = await request.ctx.prisma.user.findUniqueOrThrow({ where: { id: request.session.userId }, select: { providerCustomerId: true } });
  if (!user.providerCustomerId) return sendResponse(reply, { invoices: [] });
  const list = await getBillingProvider().listInvoices(user.providerCustomerId, 24);
  const invoices = list
    .filter((i) => i.status !== "draft")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      reason: i.billingReason,
      createdAt: i.createdAt.toISOString(),
      totalCents: i.totalCents,
      amountPaidCents: i.amountPaidCents,
      currency: i.currency,
      hostedUrl: i.hostedUrl,
      // The provider's PDF links expire, so they are fetched per click through
      // the endpoint below rather than handed out with the list.
      pdfUrl: null,
    }));
  return sendResponse(reply, { invoices });
};

/**
 * A fresh link to one invoice's PDF. The provider's link is short lived, so it
 * is fetched on demand and never stored. Scoped to the customer's own
 * invoices: an id from anyone else answers 404.
 */
export const invoicePdfController = async (
  request: FastifyRequest<{ Params: { invoiceId: string } }>,
  reply: FastifyReply,
) => {
  const user = await request.ctx.prisma.user.findUniqueOrThrow({
    where: { id: request.session.userId },
    select: { providerCustomerId: true },
  });
  if (!user.providerCustomerId) throw notFound("No invoices yet");

  const provider = getBillingProvider();
  const invoice = await provider.getTransaction(request.params.invoiceId).catch(() => null);
  if (!invoice || invoice.customerId !== user.providerCustomerId) throw notFound("Invoice not found");

  const url = await provider.invoicePdfUrl(invoice.id);
  if (!url) throw notFound("This invoice has no PDF yet");
  return sendResponse(reply, { url });
};

export const changePreviewController = async (
  request: FastifyRequest<{ Querystring: { planId: string; billingCycle: Cycle } }>,
  reply: FastifyReply,
) => {
  const preview = await previewPlanChange(request.ctx, request.session.userId, request.query);
  return sendResponse(reply, preview);
};

export const cancelPendingChangeController = async (request: FastifyRequest, reply: FastifyReply) => {
  const result = await cancelPendingChange(request.ctx, getBillingProvider(), request.session.userId);
  return sendResponse(reply, result);
};

export const cancelPreviewController = async (request: FastifyRequest, reply: FastifyReply) => {
  const preview = await previewCancellation(request.ctx, request.session.userId);
  return sendResponse(reply, preview);
};

/** Customer sets their monthly spending cap, in cents, base included. */
export const spendCapController = async (
  request: FastifyRequest<{ Body: { capCents: number } }>,
  reply: FastifyReply,
) => {
  const result = await setSpendCap(request.ctx, request.session.userId, request.body.capCents);
  return sendResponse(reply, result);
};

type Cycle = "MONTHLY" | "YEARLY";

/**
 * Start checkout. The answer is not a URL but what the browser needs to open
 * the provider's checkout: Paddle's is an overlay opened by its own script,
 * with a public client token this endpoint hands over so the dashboard bundle
 * carries no installation-specific values.
 */
export const checkoutController = async (
  request: FastifyRequest<{ Body: { planId: string; billingCycle?: Cycle } }>,
  reply: FastifyReply,
) => {
  const { planId, billingCycle = "MONTHLY" } = request.body;
  const checkout = await startCheckout(
    request.ctx,
    getBillingProvider(),
    request.session.userId,
    planId,
    billingCycle,
  );
  return sendResponse(reply, checkout);
};

/**
 * The provider script's public configuration. The billing page needs it on
 * load when the provider sent the customer there to finish a payment (Paddle
 * appends `_ptxn` to the default payment link); with it, the script opens that
 * transaction's checkout by itself. Null when billing is off.
 */
export const checkoutConfigController = async (request: FastifyRequest, reply: FastifyReply) => {
  const config = hasBillingProvider() ? getBillingProvider().checkoutConfig() : null;
  // The provider's customer id lets the script identify the customer to
  // Paddle Retain (payment recovery, cancellation flows). Null until the
  // account has bought something; nothing to retain before that.
  const user = await request.ctx.prisma.user.findUnique({ where: { id: request.session.userId }, select: { providerCustomerId: true } });
  return sendResponse(reply, { config, customerId: user?.providerCustomerId ?? null });
};

export const portalController = async (request: FastifyRequest, reply: FastifyReply) => {
  const url = await createBillingPortal(request.ctx, getBillingProvider(), request.session.userId);
  return sendResponse(reply, { url });
};

export const cancelController = async (request: FastifyRequest, reply: FastifyReply) => {
  const result = await cancelSubscription(request.ctx, getBillingProvider(), request.session.userId);
  return sendResponse(reply, { canceled: true, ...result });
};

export const resumeController = async (request: FastifyRequest, reply: FastifyReply) => {
  const result = await resumeSubscription(request.ctx, getBillingProvider(), request.session.userId);
  return sendResponse(reply, result);
};

export const changePlanController = async (
  request: FastifyRequest<{ Body: { planId: string; billingCycle: Cycle } }>,
  reply: FastifyReply,
) => {
  const result = await changePlan(request.ctx, getBillingProvider(), request.session.userId, request.body);
  return sendResponse(reply, result);
};

export const mySubController = async (request: FastifyRequest, reply: FastifyReply) => {
  const data = await getMySubscription(request.ctx, request.session.userId);
  return sendResponse(reply, data);
};

/** The billing page's one read: plan, access state, period and exact usage. */
export const usageController = async (request: FastifyRequest, reply: FastifyReply) => {
  const summary = await getUsageSummary(request.ctx, request.session.userId);
  return sendResponse(reply, summary);
};

/**
 * Provider webhook. Registered in an encapsulated scope whose JSON parser keeps
 * the raw buffer, because signature verification runs over the exact bytes
 * the provider sent. Never move this to the default parsed-JSON scope.
 */
export const paddleWebhookController = async (request: FastifyRequest, reply: FastifyReply) => {
  // Defence in depth ahead of the signature: a delivery from an address Paddle
  // does not publish is refused before any work. "unknown" (list never
  // fetched) falls through to the signature check, which is the real gate.
  if (PADDLE_IP_ALLOWLIST) {
    const verdict = await isKnownPaddleIp(request.ip, PADDLE_ENVIRONMENT);
    if (verdict === "no") {
      console.warn(`[webhook] rejected: ${request.ip} is not a Paddle address`);
      throw forbidden("Not a recognised webhook source");
    }
  }

  const signature = request.headers["paddle-signature"];

  if (!signature || typeof signature !== "string") throw badRequest("Missing paddle-signature header");
  if (!PADDLE_WEBHOOK_SECRET) throw badRequest("PADDLE_WEBHOOK_SECRET is not configured");
  if (!Buffer.isBuffer(request.body)) throw badRequest("Expected raw body for webhook verification");

  const provider = getBillingProvider();
  // A bad signature is a permanent failure, so it must answer 4xx: a 500 has
  // the provider retrying for days over something that can never succeed, and
  // tells anyone probing the endpoint that they broke the server.
  const event = await provider.parseWebhook(request.body, signature, PADDLE_WEBHOOK_SECRET).catch((err) => {
    console.warn(`[webhook] rejected: ${err instanceof Error ? err.message : err}`);
    throw badRequest("Webhook signature verification failed");
  });
  const outcome = await processWebhookEvent(request.ctx, provider, event);

  return reply.send({ received: true, outcome });
};
