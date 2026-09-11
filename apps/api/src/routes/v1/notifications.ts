import { FastifyInstance } from "fastify";

import {
  type AlertBody,
  type ReportBody,
  type ReportParams,
  deleteAlertController,
  deleteReportController,
  getNotificationsController,
  testReportController,
  upsertAlertController,
  upsertReportController,
} from "../../controllers/notifications.controller.js";
import {
  alertBodySchema,
  notificationSiteParamsSchema,
  reportBodySchema,
  reportParamsSchema,
} from "../../schemas/notifications.schema.js";

type SiteParams = { siteId: string };

/**
 * Per-site email notifications: scheduled weekly and monthly reports, and the
 * traffic spike alert. Reading needs any access to the site; changing needs
 * the owner or an ADMIN member (enforced in the services).
 */
export default async function notificationRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get<{ Params: SiteParams }>(
    "/websites/:siteId/notifications",
    { ...auth, schema: { params: notificationSiteParamsSchema } },
    getNotificationsController,
  );

  fastify.put<{ Params: ReportParams; Body: ReportBody }>(
    "/websites/:siteId/notifications/reports/:frequency",
    { ...auth, schema: { params: reportParamsSchema, body: reportBodySchema } },
    upsertReportController,
  );

  fastify.delete<{ Params: ReportParams }>(
    "/websites/:siteId/notifications/reports/:frequency",
    { ...auth, schema: { params: reportParamsSchema } },
    deleteReportController,
  );

  fastify.post<{ Params: ReportParams }>(
    "/websites/:siteId/notifications/reports/:frequency/test",
    { ...auth, schema: { params: reportParamsSchema } },
    testReportController,
  );

  fastify.put<{ Params: SiteParams; Body: AlertBody }>(
    "/websites/:siteId/notifications/alert",
    { ...auth, schema: { params: notificationSiteParamsSchema, body: alertBodySchema } },
    upsertAlertController,
  );

  fastify.delete<{ Params: SiteParams }>(
    "/websites/:siteId/notifications/alert",
    { ...auth, schema: { params: notificationSiteParamsSchema } },
    deleteAlertController,
  );
}
