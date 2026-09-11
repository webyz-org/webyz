import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { openCheckout } from "../paddle";
import { useTheme } from "../../../shared/lib/theme";
import {
  cancelPendingChangeApi,
  cancelSubscriptionApi,
  changePlanApi,
  getCancelPreviewApi,
  getChangePreviewApi,
  getInvoicesApi,
  createCheckoutApi,
  getBillingPortalApi,
  getMyPlanApi,
  getPlansApi,
  getUsageSummaryApi,
  resumeSubscriptionApi,
  setActiveSitesApi,
  setSpendCapApi,
} from "../api";

export const usePlans = () =>
  useQuery({ queryKey: ["plans"], queryFn: getPlansApi });

export const usageSummaryKey = ["billing-usage"];

export const useUsageSummary = () =>
  useQuery({ queryKey: usageSummaryKey, queryFn: getUsageSummaryApi, staleTime: 60_000 });

export const useSetSpendCap = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setSpendCapApi,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: usageSummaryKey });
      void qc.invalidateQueries({ queryKey: ["my-plan"] });
    },
  });
};

export const useSetActiveSites = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setActiveSitesApi,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: usageSummaryKey });
      void qc.invalidateQueries({ queryKey: ["websites"] });
    },
  });
};

export const useMyPlan = () =>
  useQuery({ queryKey: ["my-plan"], queryFn: getMyPlanApi });

/**
 * Checkout is the provider's overlay, opened over this page: the API says what
 * to open and with which public token, this loads the script and opens it. The
 * mutation stays pending until the overlay closes, so the plan buttons stay
 * disabled for as long as a payment could be in progress. The subscription
 * itself appears through the webhook, so nothing here writes local state; the
 * success return reloads the page's queries.
 */
export const useCheckout = () => {
  const theme = useTheme();
  return useMutation({
    mutationFn: async ({
      planId,
      billingCycle,
    }: {
      planId: string;
      billingCycle: "MONTHLY" | "YEARLY";
    }) => {
      const handle = await createCheckoutApi(planId, billingCycle);
      await openCheckout(handle, theme);
    },
  });
};

export const useBillingPortal = () =>
  useMutation({
    mutationFn: getBillingPortalApi,
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });

const invalidateBilling = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: ["my-plan"] });
  void qc.invalidateQueries({ queryKey: usageSummaryKey });
  void qc.invalidateQueries({ queryKey: ["websites"] });
};

export const useCancelSubscription = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: cancelSubscriptionApi, onSuccess: () => invalidateBilling(qc) });
};

/** Facts before a plan change; only fetched while a target is chosen. */
export const useChangePreview = (target: { planId: string; billingCycle: "MONTHLY" | "YEARLY" } | null) =>
  useQuery({
    queryKey: ["billing-change-preview", target?.planId, target?.billingCycle],
    queryFn: () => getChangePreviewApi(target!.planId, target!.billingCycle),
    enabled: target !== null,
  });

export const useChangePlan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, billingCycle }: { planId: string; billingCycle: "MONTHLY" | "YEARLY" }) => changePlanApi(planId, billingCycle),
    onSuccess: () => invalidateBilling(qc),
  });
};

export const useCancelPendingChange = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: cancelPendingChangeApi, onSuccess: () => invalidateBilling(qc) });
};

export const useInvoices = () => useQuery({ queryKey: ["billing-invoices"], queryFn: getInvoicesApi, staleTime: 60_000 });

export const useCancelPreview = (enabled: boolean) =>
  useQuery({ queryKey: ["billing-cancel-preview"], queryFn: getCancelPreviewApi, enabled });

export const useResumeSubscription = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: resumeSubscriptionApi, onSuccess: () => invalidateBilling(qc) });
};
