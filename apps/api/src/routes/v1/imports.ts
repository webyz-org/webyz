import { FastifyInstance } from "fastify";

import {
  deleteImportController,
  discardImportConnectionController,
  getImportAuthUrlController,
  getImportConnectionController,
  completeCsvImportController,
  importCallbackController,
  deleteSiteExportController,
  downloadSiteExportController,
  getSiteExportController,
  listImportsController,
  requestSiteExportController,
  startImportController,
  startCsvImportController,
  uploadCsvChunkController,
} from "../../controllers/imports.controller.js";
import { CSV_CHUNK_LIMIT } from "../../core/imports/csv-import.service.js";

/**
 * Imports of another tool's history (Google Analytics 4). Site-scoped routes
 * check owner-or-admin in the controller; the Google callback is global and
 * must be registered on the OAuth client (GA4_IMPORT_REDIRECT_URI).
 */
type SiteParams = { siteId: string };

export default async function importRoutes(fastify: FastifyInstance) {
  const site = { preHandler: [fastify.authenticate, fastify.authorizeSite] };

  fastify.get<{ Params: SiteParams }>("/websites/:siteId/imports", site, listImportsController);
  fastify.get<{ Params: SiteParams }>("/websites/:siteId/imports/ga4/auth-url", site, getImportAuthUrlController);
  fastify.get<{ Params: SiteParams }>("/websites/:siteId/imports/ga4/connection", site, getImportConnectionController);
  fastify.delete<{ Params: SiteParams }>(
    "/websites/:siteId/imports/ga4/connection",
    site,
    discardImportConnectionController,
  );
  fastify.post<{ Params: SiteParams; Body: { propertyId: string; startDate?: string; endDate?: string } }>(
    "/websites/:siteId/imports",
    {
      ...site,
      schema: {
        body: {
          type: "object",
          properties: {
            propertyId: { type: "string", pattern: "^[0-9]{1,20}$" },
            startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          },
          required: ["propertyId"],
          additionalProperties: false,
        },
      },
    },
    startImportController,
  );
  fastify.delete<{ Params: SiteParams & { importId: string } }>(
    "/websites/:siteId/imports/:importId",
    site,
    deleteImportController,
  );

  fastify.get("/imports/ga4/callback", importCallbackController);

  // Export data, Plausible's flow: prepare, download for seven days, delete.
  type ExportParams = SiteParams & { exportId: string };
  fastify.get<{ Params: SiteParams }>("/websites/:siteId/exports", site, getSiteExportController);
  fastify.post<{ Params: SiteParams }>("/websites/:siteId/exports", site, requestSiteExportController);
  fastify.get<{ Params: ExportParams }>("/websites/:siteId/exports/:exportId/download", site, downloadSiteExportController);
  fastify.delete<{ Params: ExportParams }>("/websites/:siteId/exports/:exportId", site, deleteSiteExportController);

  // CSV import upload. Chunks arrive as raw CSV text: JSON would escape
  // every quote in the file and roughly double the bytes on the wire. The
  // parser is scoped to this plugin, so no other route accepts text/csv.
  fastify.addContentTypeParser(
    "text/csv",
    { parseAs: "string", bodyLimit: Math.ceil(CSV_CHUNK_LIMIT * 1.1) },
    (_request, body, done) => done(null, body),
  );

  fastify.post<{ Params: SiteParams; Body: { files: string[]; name?: string; chunks: number } }>(
    "/websites/:siteId/imports/csv",
    {
      ...site,
      schema: {
        body: {
          type: "object",
          properties: {
            files: {
              type: "array",
              minItems: 1,
              maxItems: 20,
              items: { type: "string", maxLength: 200 },
            },
            name: { type: "string", maxLength: 200 },
            chunks: { type: "integer", minimum: 1, maximum: 1_000_000 },
          },
          required: ["files", "chunks"],
          additionalProperties: false,
        },
      },
    },
    startCsvImportController,
  );
  fastify.put<{ Params: SiteParams & { importId: string }; Querystring: { file: string; index: string } }>(
    "/websites/:siteId/imports/:importId/chunks",
    {
      ...site,
      // A large export is hundreds of chunks sent back to back; the global
      // per-minute limit is sized for dashboard reads, not uploads.
      config: { rateLimit: { max: 3000, timeWindow: "1 minute" } },
      schema: {
        querystring: {
          type: "object",
          properties: {
            file: { type: "string", maxLength: 200 },
            index: { type: "string", pattern: "^[0-9]{1,7}$" },
          },
          required: ["file", "index"],
        },
      },
    },
    uploadCsvChunkController,
  );
  fastify.post<{ Params: SiteParams & { importId: string } }>(
    "/websites/:siteId/imports/:importId/complete",
    site,
    completeCsvImportController,
  );
}
