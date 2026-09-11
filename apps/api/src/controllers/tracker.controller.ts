import { FastifyReply, FastifyRequest } from "fastify";

import { TrackingPayload } from "../ingest/types.js";
import { publishTracking } from "../ingest/http/publish-tracking.js";
import { checkIngestAllowed } from "../core/tracker/tracking.service.js";
import { hostnameOf } from "../utils/hostname.js";

/** 1x1 transparent GIF for the no-JavaScript pixel fallback. */
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

const PIXEL_HEADERS = {
  "Content-Type": "image/gif",
  "Cache-Control": "no-cache, no-store, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

/**
 * Ingest.
 *
 * Both verbs run the same quota check. The POST branch previously had its check
 * commented out, so a site over its free limit kept writing events even after
 * the enforcement job had blocked it.
 *
 * Status choices, which are deliberate:
 *  - unknown site id -> 404, so a developer installing the snippet sees the
 *    mistake instead of silently sending events into nothing.
 *  - over quota -> 202 Accepted with nothing written. The visitor's browser is
 *    not the right place to surface a billing problem, and a hard error on a
 *    customer's site is worse than a dropped datapoint. The dashboard and the
 *    billing page are where the block is reported.
 *  - malformed POST -> 400 from the route schema, so a bad integration is
 *    visible. The pixel GET instead attaches the validation error and still
 *    returns the image, writing nothing.
 */
export const handleTrackerPost = async (
  request: FastifyRequest<{ Body: TrackingPayload }>,
  reply: FastifyReply,
) => {
  const usage = await checkIngestAllowed(request.ctx, request.body.sid, hostnameOf(request.body.url));

  if (!usage.allowed) {
    if (usage.code === "website_not_found") {
      return reply.code(404).send({
        success: false,
        error: { code: usage.code, message: usage.message },
      });
    }

    return reply.code(202).send();
  }

  await publishTracking(request.body, request);
  return reply.code(204).send();
};

export const handleTrackingGet = async (
  request: FastifyRequest<{ Querystring: TrackingPayload }>,
  reply: FastifyReply,
) => {
  // The pixel always renders, whatever happens, so a blocked, misconfigured
  // or malformed install never shows a broken image to visitors.
  if (!request.validationError) {
    try {
      const usage = await checkIngestAllowed(request.ctx, request.query.sid, hostnameOf(request.query.url));
      if (usage.allowed) await publishTracking(request.query, request);
    } catch (err) {
      request.log.error({ err }, "pixel ingest failed");
    }
  }

  return reply.code(200).headers(PIXEL_HEADERS).send(PIXEL);
};
