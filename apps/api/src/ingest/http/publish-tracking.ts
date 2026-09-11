import { FastifyRequest } from "fastify";

import { TrackingPayload } from "../types.js";
import { KAFKA_ENABLED, KAFKA_TRACK_TOPIC } from "../../config/env.js";
import { track } from "../../core/tracker/tracking.service.js";
import { normalizeTracking } from "../normalize/normalize-tracking.js";

export const publishTracking = async (
  payload: TrackingPayload,
  request: FastifyRequest,
) => {
  // Kafka path
  if (KAFKA_ENABLED && request.server.kafkaProducer) {
    try {
      await request.server.kafkaProducer.send({
        topic: KAFKA_TRACK_TOPIC,
        messages: [
          {
            key: payload.sid,
            value: JSON.stringify({
              payload,
              // The address is resolved here, under trustProxy, and forwarded
              // as a value: the worker must not re-derive it from headers.
              ip: request.ip,
              // The event time is when the API received it, carried to the
              // worker so a queue delay never shifts an event's hour.
              receivedAt: new Date().toISOString(),
              headers: {
                "user-agent": request.headers["user-agent"],
                host: request.headers["host"],
              },
            }),
          },
        ],
      });
      return;
    } catch (err) {
      request.log.error(err, "Kafka publish failed, falling back");
    }
  }

  const normalized = await normalizeTracking(payload, request);
  if (!normalized) return;

  await track({ clickhouse: request.server.clickhouse }, normalized);
};
