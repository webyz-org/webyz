import { FastifyReply, FastifyRequest } from "fastify";

import { sendResponse } from "../http/helper/send-response.js";
import type { ReportFrequency } from "../generated/prisma/client.js";
import {
  deleteEmailReport,
  listEmailReports,
  sendTestReport,
  upsertEmailReport,
} from "../core/notifications/email-reports.service.js";
import {
  deleteTrafficAlert,
  getTrafficAlert,
  upsertTrafficAlert,
} from "../core/notifications/traffic-alerts.service.js";

type SiteParams = { siteId: string };
export type ReportParams = { siteId: string; frequency: "weekly" | "monthly" };
export type ReportBody = { recipients: string[] };
export type AlertBody = { threshold: number; recipients: string[] };

/** URL frequencies are lowercase; the enum is uppercase. The schema has already restricted the value. */
const toFrequency = (f: ReportParams["frequency"]): ReportFrequency => (f === "weekly" ? "WEEKLY" : "MONTHLY");

/** Reports and the alert in one answer, which is what the settings section renders. */
export const getNotificationsController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const { userId } = request.session;
  const { siteId } = request.params;
  const [reports, alert] = await Promise.all([
    listEmailReports(request.ctx, userId, siteId),
    getTrafficAlert(request.ctx, userId, siteId),
  ]);
  return sendResponse(reply, { reports, alert });
};

export const upsertReportController = async (
  request: FastifyRequest<{ Params: ReportParams; Body: ReportBody }>,
  reply: FastifyReply,
) => {
  const report = await upsertEmailReport(
    request.ctx,
    request.session.userId,
    request.params.siteId,
    toFrequency(request.params.frequency),
    request.body.recipients,
  );
  return sendResponse(reply, report);
};

export const deleteReportController = async (
  request: FastifyRequest<{ Params: ReportParams }>,
  reply: FastifyReply,
) => {
  const result = await deleteEmailReport(
    request.ctx,
    request.session.userId,
    request.params.siteId,
    toFrequency(request.params.frequency),
  );
  return sendResponse(reply, result);
};

/** Sends the latest completed period to the caller's own address, now. */
export const testReportController = async (
  request: FastifyRequest<{ Params: ReportParams }>,
  reply: FastifyReply,
) => {
  const result = await sendTestReport(
    request.ctx,
    request.session.userId,
    request.params.siteId,
    toFrequency(request.params.frequency),
    request.session.email,
  );
  return sendResponse(reply, result);
};

export const upsertAlertController = async (
  request: FastifyRequest<{ Params: SiteParams; Body: AlertBody }>,
  reply: FastifyReply,
) => {
  const alert = await upsertTrafficAlert(request.ctx, request.session.userId, request.params.siteId, request.body);
  return sendResponse(reply, alert);
};

export const deleteAlertController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const result = await deleteTrafficAlert(request.ctx, request.session.userId, request.params.siteId);
  return sendResponse(reply, result);
};
