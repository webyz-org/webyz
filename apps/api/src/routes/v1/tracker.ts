import { FastifyInstance } from "fastify";
import { Ajv } from "ajv";

import {
  handleTrackerPost,
  handleTrackingGet,
} from "../../controllers/tracker.controller.js";
import { trackingSchema } from "../../schemas/tracking.schema.js";

/**
 * Ingest is exempt from the per-IP API limiter: many visitors share one IP
 * behind NAT, and a busy customer site would be throttled by its own traffic.
 * Abuse controls for ingest are per site and live in the ingest guard.
 */
const noLimit = { rateLimit: false as const };

/** A pageview is a few hundred bytes; 16 KB leaves room for generous custom props. */
const BODY_LIMIT = 16 * 1024;

/**
 * The app-wide validator strips unknown properties (removeAdditional: "all"),
 * which would delete every custom event property before the handler saw it.
 * This plugin scope gets its own validator that validates unknown properties
 * against the schema's `additionalProperties` instead of removing them.
 * coerceTypes turns the pixel GET's query strings into the numbers the schema
 * expects (`ts`, `new_session`).
 */
const ajv = new Ajv({ coerceTypes: true, removeAdditional: false, allErrors: false, useDefaults: true });

export default async function trackerRoutes(fastify: FastifyInstance) {
  fastify.setValidatorCompiler(({ schema }) => ajv.compile(schema));

  // A malformed body is a 400 so a broken install shows up in the network tab.
  fastify.post("/track", { config: noLimit, bodyLimit: BODY_LIMIT, schema: { body: trackingSchema } }, handleTrackerPost);

  // The pixel must always render, so validation errors are attached rather
  // than sent: the controller returns the image and writes nothing.
  fastify.get(
    "/track",
    { config: noLimit, attachValidation: true, schema: { querystring: trackingSchema } },
    handleTrackingGet,
  );
}
