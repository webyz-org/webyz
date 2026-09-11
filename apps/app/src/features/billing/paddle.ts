/**
 * Paddle.js, loaded on demand.
 *
 * Checkout is the provider's own overlay, not a page of ours: Paddle is the
 * merchant of record, so the card, the address and the tax all belong to its
 * form and never touch this app. Everything it needs comes from the API
 * (`POST /billing/checkout`), including the public client token, so one
 * prebuilt dashboard image works for any installation.
 */

export type CheckoutHandle =
  | { kind: "redirect"; url: string }
  | {
      kind: "overlay";
      provider: string;
      clientToken: string;
      environment: "sandbox" | "production";
      priceId: string;
      quantity: number;
      customerId: string;
      customData: Record<string, string>;
      successUrl: string;
    };

type PaddleEvent = { name: string; data?: unknown };

type PaddleGlobal = {
  Environment: { set: (env: string) => void };
  Initialize: (opts: { token: string; eventCallback?: (event: PaddleEvent) => void; pwCustomer?: { id: string } }) => void;
  Checkout: {
    open: (opts: {
      items: { priceId: string; quantity: number }[];
      customer?: { id: string };
      customData?: Record<string, string>;
      settings?: { displayMode?: string; successUrl?: string; theme?: string; allowLogout?: boolean };
    }) => void;
  };
};

/**
 * Paddle.js takes one event callback, at initialisation, for the life of the
 * page. Everything that cares about checkout events subscribes here instead.
 */
const listeners = new Set<(event: PaddleEvent) => void>();
const dispatch = (event: PaddleEvent) => {
  for (const l of listeners) l(event);
};

/** True while an overlay is open, so a second click cannot open a second one. */
let checkoutOpen = false;

const SRC = "https://cdn.paddle.com/paddle/v2/paddle.js";

let loading: Promise<PaddleGlobal> | null = null;
let initializedFor: string | null = null;

const loadScript = (): Promise<PaddleGlobal> => {
  if (loading) return loading;
  loading = new Promise<PaddleGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
    const onReady = () => {
      const paddle = (window as unknown as { Paddle?: PaddleGlobal }).Paddle;
      if (paddle) resolve(paddle);
      else reject(new Error("Paddle.js loaded but did not register"));
    };
    if (existing) {
      existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Paddle.js")), { once: true });
      if ((window as unknown as { Paddle?: PaddleGlobal }).Paddle) onReady();
      return;
    }
    const script = document.createElement("script");
    script.src = SRC;
    script.async = true;
    script.addEventListener("load", onReady, { once: true });
    script.addEventListener("error", () => {
      // Let the next attempt try again rather than caching the failure: an ad
      // blocker or a dropped connection is not permanent.
      loading = null;
      reject(new Error("Could not load the payment form. Check your connection or any blocking extension."));
    });
    document.head.appendChild(script);
  });
  return loading;
};

export type CheckoutConfig = { provider: string; clientToken: string; environment: "sandbox" | "production" } | null;

/**
 * Load and initialise the provider's script without opening anything.
 *
 * Paddle appends `_ptxn=<transaction>` to the default payment link when it
 * sends a customer somewhere to finish a payment (a failed renewal, an
 * invoice). That link is this billing page, and Paddle.js opens that
 * transaction's checkout by itself when it initialises on a page whose URL
 * carries the parameter. So the page calls this on load when `_ptxn` is
 * present, and the customer sees the payment form instead of nothing.
 */
export const initPaddle = async (config: CheckoutConfig, customerId?: string | null) => {
  if (!config) return;
  const paddle = await loadScript();
  // Environment and token must be set before the first open, and Paddle.js
  // accepts Initialize once per page. The customer id is for Paddle Retain
  // (payment recovery and cancellation flows), which needs to know who is
  // signed in; it must be Paddle's id, never ours or an email.
  if (initializedFor !== config.clientToken) {
    paddle.Environment.set(config.environment);
    paddle.Initialize({
      token: config.clientToken,
      eventCallback: dispatch,
      ...(customerId ? { pwCustomer: { id: customerId } } : {}),
    });
    initializedFor = config.clientToken;
  }
  return paddle;
};

/**
 * Open the provider's checkout for what the API described.
 *
 * Resolves when the overlay closes, whether the customer paid or gave up, so
 * a caller that shows a busy state keeps showing it for as long as a payment
 * could still be in progress. Two things learnt from a real customer in the
 * sandbox shape the settings: the email is locked (`allowLogout: false`),
 * because Paddle attaches the subscription to whatever email is typed in and
 * a different one creates a second customer; and a second open while one
 * overlay is up is refused, because two completed checkouts are two live
 * subscriptions and a refund conversation.
 */
export const openCheckout = async (handle: CheckoutHandle, theme: "light" | "dark"): Promise<void> => {
  if (handle.kind === "redirect") {
    window.location.href = handle.url;
    return;
  }
  if (checkoutOpen) return;
  const paddle = (await initPaddle({ provider: handle.provider, clientToken: handle.clientToken, environment: handle.environment }))!;

  return new Promise<void>((resolve) => {
    const done = (event: PaddleEvent) => {
      // `checkout.completed` is followed by the redirect to successUrl;
      // `checkout.closed` is the customer leaving without paying.
      if (event.name !== "checkout.closed" && event.name !== "checkout.completed") return;
      listeners.delete(done);
      checkoutOpen = false;
      resolve();
    };
    listeners.add(done);
    checkoutOpen = true;
    paddle.Checkout.open({
      items: [{ priceId: handle.priceId, quantity: handle.quantity }],
      customer: { id: handle.customerId },
      customData: handle.customData,
      settings: { displayMode: "overlay", successUrl: handle.successUrl, theme, allowLogout: false },
    });
  });
};
