import { del, get, patch, post } from "../../lib/axios";
import type {
  Funnel,
  FunnelAnalysis,
  FunnelInput,
  FunnelMetric,
  GoalDetailResponse,
} from "./types";

export const listFunnelsApi = (siteId: string) =>
  get<Funnel[]>(`/websites/${siteId}/funnels`);

export const createFunnelApi = (siteId: string, input: FunnelInput) =>
  post<Funnel>(`/websites/${siteId}/funnels`, input);

export const updateFunnelApi = (
  siteId: string,
  funnelId: string,
  input: FunnelInput,
) => patch<Funnel>(`/websites/${siteId}/funnels/${funnelId}`, input);

export const deleteFunnelApi = (siteId: string, funnelId: string) =>
  del<{ deleted: boolean }>(`/websites/${siteId}/funnels/${funnelId}`);

/** The reporting window; from/to only accompany period=custom. */
export type PeriodWindow = { period: string; from?: string; to?: string };

const windowParams = (window: PeriodWindow) => ({
  period: window.period,
  ...(window.from ? { from: window.from } : {}),
  ...(window.to ? { to: window.to } : {}),
});

export const getFunnelAnalysisApi = (
  siteId: string,
  funnelId: string,
  window: PeriodWindow,
  metric: FunnelMetric,
) =>
  get<FunnelAnalysis>(`/websites/${siteId}/funnels/${funnelId}/analysis`, {
    ...windowParams(window),
    metric,
  });

export const getGoalDetailApi = (
  siteId: string,
  goalId: string,
  window: PeriodWindow,
) =>
  get<GoalDetailResponse>(
    `/websites/${siteId}/goals/${goalId}/detail`,
    windowParams(window),
  );
