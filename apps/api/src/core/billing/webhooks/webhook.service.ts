import type { AppContext } from "../../../lib/context.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { BillingProvider, ProviderEvent } from "../provider/billing-provider.js";
import { PADDLE_HANDLED_EVENT_TYPES, handlePaddleEvent } from "../provider/paddle.webhooks.js";

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

/**
 * Whether an event already on record should be handled again.
 *
 * PROCESSED and IGNORED are final. RECEIVED means a previous attempt crashed
 * before finishing, FAILED means it threw; both are retried, because the
 * provider redelivers exactly for that case.
 */
export const shouldReprocess = (
  existing: { status: "RECEIVED" | "PROCESSED" | "FAILED" | "IGNORED" } | null,
): boolean => existing === null || existing.status === "RECEIVED" || existing.status === "FAILED";

type Handler = (ctx: AppContext, provider: BillingProvider, event: ProviderEvent) => Promise<void>;

const HANDLERS: Record<string, { types: ReadonlySet<string>; handle: Handler }> = {
  paddle: { types: PADDLE_HANDLED_EVENT_TYPES, handle: handlePaddleEvent },
};

/**
 * Idempotent webhook entry point. The provider's event id is the primary key
 * of billing_events and is inserted before any handler runs, so:
 *  - a redelivered event is answered 200 without side effects;
 *  - a crash mid-handler leaves a RECEIVED row that the redelivery retries;
 *  - order does not matter, because handlers write current object state.
 */
export const processWebhookEvent = async (
  ctx: AppContext,
  provider: BillingProvider,
  event: ProviderEvent,
): Promise<WebhookOutcome> => {
  const { prisma } = ctx;
  const handler = HANDLERS[provider.name];
  if (!handler) throw new Error(`No webhook handler for provider "${provider.name}"`);

  let claimed = false;
  try {
    await prisma.billingEvent.create({
      data: {
        id: event.id,
        provider: provider.name,
        type: event.type,
        status: "RECEIVED",
        payload: event.data as Prisma.InputJsonValue,
      },
    });
    claimed = true;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
  }

  if (!claimed) {
    const existing = await prisma.billingEvent.findUnique({ where: { id: event.id }, select: { status: true } });
    if (!shouldReprocess(existing)) {
      console.log(`[webhook] duplicate ${event.type} ${event.id}, already ${existing?.status}`);
      return "duplicate";
    }
    console.log(`[webhook] retrying ${event.type} ${event.id}, previous status ${existing?.status}`);
  }

  if (!handler.types.has(event.type)) {
    await prisma.billingEvent.update({
      where: { id: event.id },
      data: { status: "IGNORED", processedAt: new Date() },
    });
    return "ignored";
  }

  try {
    await handler.handle(ctx, provider, event);
    await prisma.billingEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date(), error: null },
    });
    return "processed";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.billingEvent
      .update({ where: { id: event.id }, data: { status: "FAILED", error: message.slice(0, 2000) } })
      .catch(() => {});
    throw err;
  }
};
