import { get, post, put } from "../../lib/axios";
import type { CheckoutConfig, CheckoutHandle } from "../billing/paddle";
import type { CancelPreview, ChangePreview, CurrentPlan, InvoiceRow, Plan, UsageSummary } from "./types";

export const getUsageSummaryApi = () => get<UsageSummary>("/billing/usage");

export type SetSpendCapResult = {
  capCents: number;
  effective: "now" | "next_period";
  pendingCents: number | null;
  alreadyExceeded: boolean;
  currentBillCents: number;
  restrictionLifted: boolean;
  message: string;
};

export const setSpendCapApi = (capCents: number) =>
  put<SetSpendCapResult>("/billing/spend-cap", { capCents });

/** Which sites stay active when the plan allows fewer than the account has. */
export const setActiveSitesApi = (activeIds: string[]) =>
  post<{ limit: number; active: number }>("/websites/active", { activeIds });

export const getPlansApi = () => get<Plan[]>("/plans");

export const getMyPlanApi = () => get<CurrentPlan>("/plans/me");

/**
 * Ask the API to start checkout. It answers with what the browser needs to
 * open the provider's form, not a URL of ours.
 */
export const createCheckoutApi = (
  planId: string,
  billingCycle: "MONTHLY" | "YEARLY",
) => post<CheckoutHandle>("/billing/checkout", { planId, billingCycle });

export const getBillingPortalApi = () => get<{ url: string }>("/billing/portal");

/** The provider script's public configuration, for finishing a payment the provider sent us. */
export const getCheckoutConfigApi = () => get<{ config: CheckoutConfig; customerId: string | null }>("/billing/checkout-config");

export const cancelSubscriptionApi = () =>
  post<{ canceled: boolean }>("/billing/cancel");

export const resumeSubscriptionApi = () =>
  post<{ resumed: boolean }>("/billing/resume");

export const getChangePreviewApi = (planId: string, billingCycle: "MONTHLY" | "YEARLY") =>
  get<ChangePreview>(`/billing/change-preview?planId=${encodeURIComponent(planId)}&billingCycle=${billingCycle}`);

export type ChangePlanResult =
  | { applied: "now"; planId: string; billingCycle: "MONTHLY" | "YEARLY" }
  | { applied: "scheduled"; planId: string; billingCycle: "MONTHLY" | "YEARLY"; effectiveAt: string };

export const changePlanApi = (planId: string, billingCycle: "MONTHLY" | "YEARLY") =>
  post<ChangePlanResult>("/billing/change-plan", { planId, billingCycle });

export const cancelPendingChangeApi = () => post<{ canceled: boolean }>("/billing/change-plan/cancel");

export const getCancelPreviewApi = () => get<CancelPreview>("/billing/cancel-preview");

export const getInvoicesApi = () => get<{ invoices: InvoiceRow[] }>("/billing/invoices");

/** The provider's PDF links expire, so one is fetched per click. */
export const getInvoicePdfApi = (invoiceId: string) =>
  get<{ url: string }>(`/billing/invoices/${encodeURIComponent(invoiceId)}/pdf`);
