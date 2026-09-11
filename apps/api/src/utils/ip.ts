import { FastifyRequest } from "fastify";

/**
 * The client address as Fastify resolved it under `trustProxy` (see
 * config/trust-proxy.ts). Nothing here reads X-Forwarded-For or X-Real-IP
 * itself any more: those headers are client-writable until a trusted proxy
 * overwrites them, and parsing them by hand is how the address became
 * spoofable in the first place.
 */
export const getClientIP = (request: FastifyRequest): string => request.ip || "127.0.0.1";
