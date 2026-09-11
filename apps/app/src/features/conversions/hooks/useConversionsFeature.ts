import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createFunnelApi,
  deleteFunnelApi,
  getFunnelAnalysisApi,
  getGoalDetailApi,
  listFunnelsApi,
  updateFunnelApi,
  type PeriodWindow,
} from "../api";
import type { FunnelInput, FunnelMetric } from "../types";

const funnelsKey = (siteId?: string) => ["funnels", siteId];

export const useFunnels = (siteId?: string) =>
  useQuery({
    queryKey: funnelsKey(siteId),
    queryFn: () => listFunnelsApi(siteId!),
    enabled: Boolean(siteId),
  });

export const useCreateFunnel = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FunnelInput) => createFunnelApi(siteId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: funnelsKey(siteId) }),
  });
};

export const useUpdateFunnel = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ funnelId, input }: { funnelId: string; input: FunnelInput }) =>
      updateFunnelApi(siteId, funnelId, input),
    onSuccess: (_, { funnelId }) => {
      qc.invalidateQueries({ queryKey: funnelsKey(siteId) });
      qc.invalidateQueries({ queryKey: ["funnel-analysis", siteId, funnelId] });
    },
  });
};

export const useDeleteFunnel = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (funnelId: string) => deleteFunnelApi(siteId, funnelId),
    onSuccess: () => qc.invalidateQueries({ queryKey: funnelsKey(siteId) }),
  });
};

export const useFunnelAnalysis = (
  siteId: string | undefined,
  funnelId: string | undefined,
  range: PeriodWindow,
  metric: FunnelMetric,
) =>
  useQuery({
    queryKey: [
      "funnel-analysis",
      siteId,
      funnelId,
      range.period,
      range.from ?? null,
      range.to ?? null,
      metric,
    ],
    queryFn: () => getFunnelAnalysisApi(siteId!, funnelId!, range, metric),
    enabled: Boolean(siteId && funnelId),
    placeholderData: (previous) => previous,
  });

export const useGoalDetail = (
  siteId: string | undefined,
  goalId: string | undefined,
  range: PeriodWindow,
) =>
  useQuery({
    queryKey: [
      "goal-detail",
      siteId,
      goalId,
      range.period,
      range.from ?? null,
      range.to ?? null,
    ],
    queryFn: () => getGoalDetailApi(siteId!, goalId!, range),
    enabled: Boolean(siteId && goalId),
    placeholderData: (previous) => previous,
  });
