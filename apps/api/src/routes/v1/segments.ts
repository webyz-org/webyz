import { FastifyInstance } from "fastify";

import {
  createSegmentController,
  deleteSegmentController,
  listSegmentsController,
  listSharedSegmentsController,
  updateSegmentController,
} from "../../controllers/segments.controller.js";
import type { SegmentInput } from "../../core/website/segments.service.js";
import {
  MAX_SEGMENT_FILTERS,
  MAX_SEGMENT_FILTER_VALUE_LENGTH,
  MAX_SEGMENT_NAME_LENGTH,
  SEGMENT_FILTER_KEYS,
} from "../../core/website/segments.service.js";

type SiteParams = { siteId: string };
type SegmentParams = SiteParams & { segmentId: string };

const filterValueSchema = {
  type: "string",
  minLength: 1,
  maxLength: MAX_SEGMENT_FILTER_VALUE_LENGTH,
};

// Every allowed key is listed under `properties` on purpose: the app-wide Ajv
// runs with removeAdditional "all" and drops anything else before the handler,
// so an unknown key vanishes and an otherwise empty object fails minProperties.
// The service re-checks keys and parses each value as a filter condition.
const filtersSchema = {
  type: "object",
  minProperties: 1,
  maxProperties: MAX_SEGMENT_FILTERS,
  properties: Object.fromEntries(SEGMENT_FILTER_KEYS.map((key) => [key, filterValueSchema])),
  additionalProperties: false,
};

const nameSchema = { type: "string", minLength: 1, maxLength: MAX_SEGMENT_NAME_LENGTH };

const createSegmentBodySchema = {
  type: "object",
  properties: { name: nameSchema, filters: filtersSchema },
  required: ["name", "filters"],
  additionalProperties: false,
};

const updateSegmentBodySchema = {
  type: "object",
  properties: { name: nameSchema, filters: filtersSchema },
  minProperties: 1,
  additionalProperties: false,
};

/**
 * Saved segments: named filter sets per site. Mounted under /api/v1 by the
 * autoloader, so these are /api/v1/websites/:siteId/segments and
 * /api/v1/shared/:slug/segments.
 */
export default async function segmentRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get<{ Params: SiteParams }>(
    "/websites/:siteId/segments",
    auth,
    listSegmentsController,
  );

  fastify.post<{ Params: SiteParams; Body: SegmentInput }>(
    "/websites/:siteId/segments",
    { ...auth, schema: { body: createSegmentBodySchema } },
    createSegmentController,
  );

  fastify.patch<{ Params: SegmentParams; Body: Partial<SegmentInput> }>(
    "/websites/:siteId/segments/:segmentId",
    { ...auth, schema: { body: updateSegmentBodySchema } },
    updateSegmentController,
  );

  fastify.delete<{ Params: SegmentParams }>(
    "/websites/:siteId/segments/:segmentId",
    auth,
    deleteSegmentController,
  );

  // Public: no auth. A shared dashboard can apply segments but not change them.
  fastify.get<{ Params: { slug: string } }>(
    "/shared/:slug/segments",
    listSharedSegmentsController,
  );
}
