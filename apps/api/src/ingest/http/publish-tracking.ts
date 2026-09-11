import { FastifyRequest } from "fastify";

import { TrackingPayload } from "../types.js";
import { track } from "../../core/tracker/tracking.service.js";
import { normalizeTracking } from "../normalize/normalize-tracking.js";

/** Normalise the payload in the request and write it to ClickHouse. */
export const publishTracking = async (
  payload: TrackingPayload,
  request: FastifyRequest,
) => {
  const normalized = await normalizeTracking(payload, request);
  if (!normalized) return;

  await track({ clickhouse: request.server.clickhouse }, normalized);
};
