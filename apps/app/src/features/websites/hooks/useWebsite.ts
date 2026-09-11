import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  clearSharePasswordApi,
  createGoalApi,
  createWebsiteApi,
  deleteGoalApi,
  deleteWebsiteApi,
  disableSharingApi,
  enableSharingApi,
  getGoalsApi,
  getInstallStatusApi,
  getSharedWebsiteApi,
  getWebsiteApi,
  getWebsitesApi,
  setSharePasswordApi,
  unlockSharedWebsiteApi,
  updateWebsiteApi,
} from "../api";
import type { Website } from "../types";

const websitesKey = ["websites"];

export const useWebsites = () =>
  useQuery({ queryKey: websitesKey, queryFn: getWebsitesApi });

export const useWebsite = (siteId?: string) =>
  useQuery({
    queryKey: ["website", siteId],
    queryFn: () => getWebsiteApi(siteId!),
    enabled: Boolean(siteId),
  });

/**
 * The dashboard URL carries the domain because it reads better than a UUID,
 * but every analytics endpoint is keyed by site id. Resolve one to the other
 * from the already-cached site list rather than adding a lookup endpoint.
 */
export const useSiteByDomain = (domain?: string) => {
  const { data, isLoading, isError } = useWebsites();

  const site: Website | undefined = domain
    ? data?.find((w) => w.domain === domain)
    : undefined;

  return {
    site,
    isLoading,
    isError,
    notFound: Boolean(domain) && !isLoading && !isError && !site,
  };
};

/**
 * Polls until the site's first event arrives, then stops. Drives the
 * "waiting for first pageview" state on the setup screen.
 */
export const useInstallStatus = (siteId?: string) =>
  useQuery({
    queryKey: ["install-status", siteId],
    queryFn: () => getInstallStatusApi(siteId!),
    enabled: Boolean(siteId),
    refetchInterval: (query) => (query.state.data?.hasEvents ? false : 3000),
    refetchIntervalInBackground: true,
  });

export const useCreateWebsite = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createWebsiteApi,
    onSuccess: () => qc.invalidateQueries({ queryKey: websitesKey }),
  });
};

export const useUpdateWebsite = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof updateWebsiteApi>[1]) =>
      updateWebsiteApi(siteId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: websitesKey });
      qc.invalidateQueries({ queryKey: ["website", siteId] });
    },
  });
};

export const useDeleteWebsite = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteWebsiteApi,
    onSuccess: () => qc.invalidateQueries({ queryKey: websitesKey }),
  });
};

export const useSharing = (siteId: string) => {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: websitesKey });
    qc.invalidateQueries({ queryKey: ["website", siteId] });
  };

  return {
    enable: useMutation({
      mutationFn: () => enableSharingApi(siteId),
      onSuccess: invalidate,
    }),
    disable: useMutation({
      mutationFn: () => disableSharingApi(siteId),
      onSuccess: invalidate,
    }),
  };
};

/** Set, replace or remove the password in front of the share link. */
export const useSharePassword = (siteId: string) => {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: websitesKey });
    qc.invalidateQueries({ queryKey: ["website", siteId] });
  };

  return {
    set: useMutation({
      mutationFn: (password: string) => setSharePasswordApi(siteId, password),
      onSuccess: invalidate,
    }),
    clear: useMutation({
      mutationFn: () => clearSharePasswordApi(siteId),
      onSuccess: invalidate,
    }),
  };
};

export const useSharedWebsite = (slug?: string) =>
  useQuery({
    queryKey: ["shared", slug],
    queryFn: () => getSharedWebsiteApi(slug!),
    enabled: Boolean(slug),
    retry: false,
  });

/** Public: the password prompt on a protected shared dashboard. */
export const useUnlockSharedWebsite = (slug: string) =>
  useMutation({
    mutationFn: (password: string) => unlockSharedWebsiteApi(slug, password),
  });

// ─── Goals ────────────────────────────────────────────────────────────────────

export const useGoals = (siteId?: string) =>
  useQuery({
    queryKey: ["goals", siteId],
    queryFn: () => getGoalsApi(siteId!),
    enabled: Boolean(siteId),
  });

export const useCreateGoal = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; eventName?: string; pagePath?: string }) =>
      createGoalApi(siteId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals", siteId] });
      qc.invalidateQueries({ queryKey: ["analytics", siteId] });
    },
  });
};

export const useDeleteGoal = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (goalId: string) => deleteGoalApi(siteId, goalId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals", siteId] });
      qc.invalidateQueries({ queryKey: ["analytics", siteId] });
    },
  });
};
