import { BILLING_ENABLED, PADDLE_CLIENT_TOKEN, PADDLE_ENVIRONMENT } from "../../../config/env.js";
import { getPaddle } from "../../../lib/paddle.js";
import type { BillingProvider } from "./billing-provider.js";
import { PaddleBillingProvider } from "./paddle.provider.js";

export * from "./billing-provider.js";

let current: BillingProvider | null = null;

/**
 * The process-wide provider. Paddle when configured. Tests and the fake
 * install their own with `setBillingProvider`. Calling this with billing
 * disabled throws, so a misconfigured server fails loudly at the first billing
 * action rather than silently pretending.
 */
export const getBillingProvider = (): BillingProvider => {
  if (current) return current;
  if (!BILLING_ENABLED) {
    throw new Error("Billing is not configured: set PADDLE_API_KEY and PADDLE_CLIENT_TOKEN, or install a provider.");
  }
  current = new PaddleBillingProvider(getPaddle(), {
    clientToken: PADDLE_CLIENT_TOKEN,
    environment: PADDLE_ENVIRONMENT,
  });
  return current;
};

export const setBillingProvider = (provider: BillingProvider | null) => {
  current = provider;
};

export const hasBillingProvider = () => current !== null || BILLING_ENABLED;
