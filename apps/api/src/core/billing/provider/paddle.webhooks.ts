import type { AppContext } from "../../../lib/context.js";
import type { BillingProvider, ProviderEvent } from "./billing-provider.js";
import {
  endSubscription,
  markPaymentFailed,
  markPaymentSucceeded,
  recordInvoice,
  syncSubscription,
} from "../subscription/lifecycle.service.js";

/**
 * Paddle event -> domain lifecycle calls. The only place Paddle event names are
 * known.
 *
 * Every handler re-reads the object from the API rather than trusting the
 * payload, for two reasons: Paddle guarantees no ordering, so a late delivery
 * would otherwise write stale state; and the notification payload is a
 * different, thinner shape than the API entity, so re-reading keeps one
 * mapping instead of two. Idempotency comes from webhooks/webhook.service.ts,
 * order independence from the lifecycle functions writing current state.
 */
export const PADDLE_HANDLED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "subscription.created",
  "subscription.activated",
  "subscription.trialing",
  "subscription.updated",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
  "subscription.canceled",
  "transaction.billed",
  "transaction.paid",
  "transaction.completed",
  "transaction.payment_failed",
  "transaction.past_due",
  "transaction.canceled",
  "transaction.revised",
]);

/** The subset of a Paddle notification body the handlers need. */
type Notified = {
  id?: string;
  subscription_id?: string | null;
  subscriptionId?: string | null;
  custom_data?: Record<string, unknown> | null;
  customData?: Record<string, unknown> | null;
};

const stringsOf = (data: Record<string, unknown> | null | undefined) => {
  if (!data) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) if (typeof v === "string") out[k] = v;
  return Object.keys(out).length ? out : undefined;
};

const subscriptionIdOf = (payload: Notified): string | null =>
  payload.subscriptionId ?? payload.subscription_id ?? null;

export const handlePaddleEvent = async (
  ctx: AppContext,
  provider: BillingProvider,
  providerEvent: ProviderEvent,
): Promise<void> => {
  const payload = (providerEvent.data ?? {}) as Notified;

  switch (providerEvent.type) {
    case "subscription.created":
    case "subscription.activated":
    case "subscription.trialing":
    case "subscription.updated":
    case "subscription.past_due":
    case "subscription.paused":
    case "subscription.resumed": {
      if (!payload.id) return;
      const current = await provider.getSubscription(payload.id);
      // The checkout's custom data names the account and plan, which is how a
      // brand new subscription finds its owner before any local row exists.
      // The event's own time judges whether a deferred change is due: a late
      // delivery then leaves it pending for the job rather than applying a
      // change the customer had not reached yet.
      await syncSubscription(ctx, provider, current, stringsOf(payload.customData ?? payload.custom_data), {
        now: providerEvent.createdAt,
      });
      return;
    }

    case "subscription.canceled": {
      if (!payload.id) return;
      await endSubscription(ctx, payload.id);
      return;
    }

    case "transaction.billed":
    case "transaction.canceled":
    case "transaction.revised": {
      // Recording only.
      if (!payload.id) return;
      await recordInvoice(ctx, await provider.getTransaction(payload.id));
      return;
    }

    case "transaction.paid":
    case "transaction.completed": {
      if (!payload.id) return;
      const invoice = await provider.getTransaction(payload.id);
      await recordInvoice(ctx, invoice);
      const subId = invoice.providerSubscriptionId ?? subscriptionIdOf(payload);
      if (subId) await markPaymentSucceeded(ctx, subId);
      return;
    }

    case "transaction.payment_failed":
    case "transaction.past_due": {
      if (!payload.id) return;
      const invoice = await provider.getTransaction(payload.id);
      await recordInvoice(ctx, invoice);
      const subId = invoice.providerSubscriptionId ?? subscriptionIdOf(payload);
      // A one-off overage charge that fails must not revoke a prepaid year, so
      // this only opens the grace window; enforcement decides the rest.
      if (subId) await markPaymentFailed(ctx, subId, providerEvent.createdAt);
      return;
    }

    default:
      return;
  }
};
