import path from "node:path";
import { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import fp from "fastify-plugin";
import fastifyAutoload from "@fastify/autoload";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";

import { registerErrorHandler } from "./plugins/error-handler.js";
import { CORS_ORIGINS } from "./config/env.js";
import authPlugin from "./plugins/auth.plugin.js";
import siteAccessPlugin from "./plugins/site-access.plugin.js";
import entitlementPlugin from "./plugins/entitlement.plugin.js";
import { registerCron } from "./cron/cron.js";
import healthRoutes from "./http/health.js";

export const options = {
  ajv: {
    customOptions: {
      coerceTypes: "array",
      removeAdditional: "all",
    },
  },
};

export default fp(async (fastify: FastifyInstance, opts) => {
  // Security headers on every response, static files included. This is an
  // API: it serves JSON, the tracker script and a pixel, never HTML, so the
  // CSP denies everything and forbids framing. The tracker is loaded by
  // customer sites from another origin, so the resource policy must allow
  // cross-origin reads or browsers would refuse the <script> tag.
  await fastify.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
    // HSTS only means something over TLS; leave it off locally so an http
    // dev origin is never pinned to https by mistake.
    strictTransportSecurity: process.env.NODE_ENV === "production",
  });

  fastify.register(cookie);

  fastify.register(fastifyStatic, {
    root: path.join(process.cwd(), "/public"),
    prefix: "/",
  });

  // Two CORS policies. Ingest must accept any origin: the tracker runs on
  // customers' sites and POSTs JSON, which preflights, and a rejected origin
  // used to fall through to a 404 on OPTIONS so every browser silently fell
  // back to the GET pixel. It never needs credentials. Everything else is a
  // strict allowlist of our own front ends, with credentials, because auth
  // rides on a cookie.
  const TRACK_PATH = "/api/v1/track";
  fastify.register(cors, {
    delegator: (req, cb) => {
      const path = (req.raw.url ?? "").split("?")[0];
      if (path === TRACK_PATH) {
        return cb(null, { origin: true, credentials: false, methods: ["GET", "POST", "OPTIONS"] });
      }
      cb(null, {
        origin: (origin, done) => {
          if (!origin) return done(null, true);
          done(null, CORS_ORIGINS.includes(origin));
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      });
    },
  });

  await fastify.register(fastifyAutoload, {
    dir: path.join(import.meta.dirname, "plugins/external"),
    options: { ...opts },
  });

  registerErrorHandler(fastify);

  // One line per response with the route pattern, never the actual URL, so
  // visitor page URLs and OAuth codes stay out of the log. Ingest and health
  // are the noise, and carry the visitor data, so they are skipped.
  const QUIET = new Set(["/api/v1/track", "/health", "/health/ready", "/api/health", "/api/health/ready"]);
  fastify.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions?.url ?? "unmatched";
    if (QUIET.has(route)) return;
    request.log.info(
      { method: request.method, route, statusCode: reply.statusCode, ms: Math.round(reply.elapsedTime) },
      "request",
    );
  });

  // Probes at both conventional places: /health for load balancers that
  // default to the root, /api/health to match everything else this serves.
  await fastify.register(healthRoutes);
  await fastify.register(healthRoutes, { prefix: "/api" });

  // Must be awaited before routes are autoloaded: routes reference
  // fastify.authenticate at registration time, not at request time.
  await fastify.register(authPlugin);
  await fastify.register(siteAccessPlugin);
  await fastify.register(entitlementPlugin);

  registerCron(fastify);

  // Must be registered before the routes: the limiter attaches through an
  // onRoute hook, so routes registered earlier were never limited at all.
  // Ingest and the provider webhook opt out per route (config.rateLimit=false);
  // auth endpoints opt in to tighter limits.
  await fastify.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    // Shared store, so limits hold across API instances instead of multiplying.
    redis: fastify.redis,
    // Redis unreachable: let the request through rather than answer 500 for
    // every limited route (which is all of them). The limiter is a brake, not
    // the security boundary; auth and quotas hold without it. The tighter
    // login and signup limits are off for the length of the outage, which is
    // accepted and visible in the logs.
    skipOnError: true,
  });

  fastify.register(fastifyAutoload, {
    dir: path.join(import.meta.dirname, "routes"),
    autoHooks: true,
    cascadeHooks: true,
    options: { prefix: "/api", ...opts },
  });

  fastify.setNotFoundHandler(
    {
      preHandler: fastify.rateLimit(),
    },
    (request, reply) => {
      request.log.warn(
        {
          request: {
            method: request.method,
            url: request.url,
            query: request.query,
            params: request.params,
          },
        },
        "Resource not found",
      );

      reply.code(404);

      return { message: "Not Found" };
    },
  );
});
