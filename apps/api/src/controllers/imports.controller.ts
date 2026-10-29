import { FastifyReply, FastifyRequest } from "fastify";

import { sendResponse } from "../http/helper/send-response.js";
import { getManagedWebsite } from "../core/website/website.service.js";
import {
  completeImportConnection,
  createImportAuthUrl,
  deleteImport,
  discardImportConnection,
  getImportConnection,
  listImports,
  startImport,
} from "../core/imports/imports.service.js";
import {
  completeCsvImport,
  startCsvImport,
  uploadCsvChunk,
} from "../core/imports/csv-import.service.js";
import {
  deleteSiteExport,
  getSiteExport,
  openSiteExport,
  requestSiteExport,
} from "../core/imports/site-export.service.js";
import { resolveRetainedWindow } from "../core/billing/entitlements/retention.js";
import { FRONTEND_URL } from "../config/env.js";

/**
 * Data imports (Google Analytics 4). Owner or admin only: an import changes
 * what every viewer of the site sees, and the connection is to someone's
 * Google account. The OAuth callback is the one unauthenticated route.
 */

type SiteParams = { siteId: string };

const managed = (request: FastifyRequest<{ Params: SiteParams }>) =>
  getManagedWebsite(request.ctx, request.session.userId, request.params.siteId);

export const listImportsController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const website = await managed(request);
  return sendResponse(reply, await listImports(request.ctx, website.id));
};

export const getImportAuthUrlController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const website = await managed(request);
  const url = await createImportAuthUrl(request.ctx, {
    siteId: website.id,
    userId: request.session.userId,
    domain: website.domain,
  });
  return sendResponse(reply, { url });
};

export const getImportConnectionController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const website = await managed(request);
  return sendResponse(reply, await getImportConnection(request.ctx, website.id));
};

export const discardImportConnectionController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const website = await managed(request);
  await discardImportConnection(request.ctx, website.id);
  return sendResponse(reply, { disconnected: true });
};

export const startImportController = async (
  request: FastifyRequest<{
    Params: SiteParams;
    Body: { propertyId: string; startDate?: string; endDate?: string };
  }>,
  reply: FastifyReply,
) => {
  const website = await managed(request);
  const created = await startImport(request.ctx, {
    siteId: website.id,
    timezone: website.timezone,
    userId: request.session.userId,
    propertyId: request.body.propertyId,
    startDate: request.body.startDate,
    endDate: request.body.endDate,
  });
  return sendResponse(reply.code(201), created);
};

export const deleteImportController = async (
  request: FastifyRequest<{ Params: SiteParams & { importId: string } }>,
  reply: FastifyReply,
) => {
  const website = await managed(request);
  await deleteImport(request.ctx, website.id, request.params.importId);
  return sendResponse(reply, { deleted: true });
};

/**
 * Google redirects the browser here after consent. The single-use Redis
 * state ties it to a site and the person who started it; it always lands
 * back on that site's import settings.
 */
export const importCallbackController = async (request: FastifyRequest, reply: FastifyReply) => {
  const { state, code, error } = request.query as { state?: string; code?: string; error?: string };
  if (error || !state || !code) return reply.redirect(`${FRONTEND_URL}/sites?ga4=error`);
  try {
    const { domain } = await completeImportConnection(request.ctx, state, code);
    return reply.redirect(`${FRONTEND_URL}/sites/${encodeURIComponent(domain)}/settings?section=imports&ga4=connected`);
  } catch (err) {
    request.log.error({ err }, "GA4 import connection failed");
    return reply.redirect(`${FRONTEND_URL}/sites?ga4=error`);
  }
};

// ─── CSV import (Plausible's format, from any tool) ───────────────────────────

export const startCsvImportController = async (
  request: FastifyRequest<{ Params: SiteParams; Body: { files: string[]; name?: string; chunks: number } }>,
  reply: FastifyReply,
) => {
  const website = await managed(request);
  const created = await startCsvImport(request.ctx, {
    siteId: website.id,
    timezone: website.timezone,
    userId: request.session.userId,
    files: request.body.files,
    name: request.body.name,
    chunks: request.body.chunks,
  });
  return sendResponse(reply.code(201), created);
};

/** One chunk of one CSV, as the raw text/csv body; `file` and `index` in the query. */
export const uploadCsvChunkController = async (
  request: FastifyRequest<{ Params: SiteParams & { importId: string }; Querystring: { file: string; index: string } }>,
  reply: FastifyReply,
) => {
  const website = await managed(request);
  const result = await uploadCsvChunk(request.ctx, {
    siteId: website.id,
    importId: request.params.importId,
    file: request.query.file,
    index: Number(request.query.index),
    csv: typeof request.body === "string" ? request.body : "",
  });
  return sendResponse(reply, result);
};

export const completeCsvImportController = async (
  request: FastifyRequest<{ Params: SiteParams & { importId: string } }>,
  reply: FastifyReply,
) => {
  const website = await managed(request);
  return sendResponse(reply, await completeCsvImport(request.ctx, website.id, request.params.importId));
};

// ─── Export ───────────────────────────────────────────────────────────────────

/** The site's current prepared export, or null. */
export const getSiteExportController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const website = await managed(request);
  return sendResponse(reply, await getSiteExport(request.ctx, website.id));
};

/**
 * "Export to CSV": prepare the site's tracked history as a zip of CSVs in the
 * import format. Owner or admin, any plan (taking your data with you is not
 * a paid feature), cut to the plan's retention like every read.
 */
export const requestSiteExportController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const website = await managed(request);
  const window = await resolveRetainedWindow(request.ctx, {
    ownerId: website.userId,
    timezone: website.timezone,
    query: { period: "all_time" },
  });
  const created = await requestSiteExport(request.ctx, {
    websiteId: website.id,
    domain: website.domain,
    timezone: website.timezone,
    from: window.from,
    to: window.to,
    userId: request.session.userId,
  });
  return sendResponse(reply.code(202), created);
};

/** Stream a prepared export. A plain GET, so the browser saves it straight to disk. */
export const downloadSiteExportController = async (
  request: FastifyRequest<{ Params: SiteParams & { exportId: string } }>,
  reply: FastifyReply,
) => {
  const website = await managed(request);
  const file = await openSiteExport(request.ctx, website.id, request.params.exportId);
  return reply
    .header("Content-Type", "application/zip")
    .header("Content-Length", String(file.size))
    .header("Content-Disposition", `attachment; filename="${file.filename}"`)
    .header("Cache-Control", "no-store")
    .send(file.stream);
};

export const deleteSiteExportController = async (
  request: FastifyRequest<{ Params: SiteParams & { exportId: string } }>,
  reply: FastifyReply,
) => {
  const website = await managed(request);
  await deleteSiteExport(request.ctx, website.id, request.params.exportId);
  return sendResponse(reply, { deleted: true });
};
