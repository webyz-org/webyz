import { FastifyRequest } from "fastify";
import { SESSION_TTL_MS } from "../../config/constants.js";

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000, // maxAge is in seconds
  };
}

/** Recorded on each session. `request.ip` is already proxy-aware; see config/trust-proxy.ts. */
export function getRequestMeta(request: FastifyRequest) {
  return {
    userAgent: request.headers["user-agent"],
    ipAddress: request.ip,
  };
}
