import { del, get, post, put } from "../../lib/axios";
import type {
  EmailReport,
  ReportFrequency,
  SiteNotifications,
  TestReportResult,
  TrafficAlert,
} from "./types";

const base = (siteId: string) => `/websites/${siteId}/notifications`;

export const getNotificationsApi = (siteId: string) =>
  get<SiteNotifications>(base(siteId));

export const upsertReportApi = (
  siteId: string,
  frequency: ReportFrequency,
  recipients: string[],
) => put<EmailReport>(`${base(siteId)}/reports/${frequency}`, { recipients });

export const deleteReportApi = (siteId: string, frequency: ReportFrequency) =>
  del<{ deleted: boolean }>(`${base(siteId)}/reports/${frequency}`);

/** Sends the latest completed period to the signed-in user's own address. */
export const testReportApi = (siteId: string, frequency: ReportFrequency) =>
  post<TestReportResult>(`${base(siteId)}/reports/${frequency}/test`);

export const upsertAlertApi = (
  siteId: string,
  data: { threshold: number; recipients: string[] },
) => put<TrafficAlert>(`${base(siteId)}/alert`, data);

export const deleteAlertApi = (siteId: string) =>
  del<{ deleted: boolean }>(`${base(siteId)}/alert`);
