import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deleteAlertApi,
  deleteReportApi,
  getNotificationsApi,
  testReportApi,
  upsertAlertApi,
  upsertReportApi,
} from "../api";
import type { ReportFrequency } from "../types";

export const notificationsKey = (siteId: string) => ["notifications", siteId];

export const useNotifications = (siteId?: string) =>
  useQuery({
    queryKey: notificationsKey(siteId ?? ""),
    queryFn: () => getNotificationsApi(siteId!),
    enabled: Boolean(siteId),
  });

/** Every mutation for the section, each refetching the one query it renders from. */
export const useNotificationMutations = (siteId: string) => {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: notificationsKey(siteId) });

  const upsertReport = useMutation({
    mutationFn: (input: { frequency: ReportFrequency; recipients: string[] }) =>
      upsertReportApi(siteId, input.frequency, input.recipients),
    onSuccess: refresh,
  });

  const deleteReport = useMutation({
    mutationFn: (frequency: ReportFrequency) => deleteReportApi(siteId, frequency),
    onSuccess: refresh,
  });

  const testReport = useMutation({
    mutationFn: (frequency: ReportFrequency) => testReportApi(siteId, frequency),
  });

  const upsertAlert = useMutation({
    mutationFn: (input: { threshold: number; recipients: string[] }) =>
      upsertAlertApi(siteId, input),
    onSuccess: refresh,
  });

  const deleteAlert = useMutation({
    mutationFn: () => deleteAlertApi(siteId),
    onSuccess: refresh,
  });

  return { upsertReport, deleteReport, testReport, upsertAlert, deleteAlert };
};
