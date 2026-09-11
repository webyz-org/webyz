import "fastify";
import { createClient } from "@clickhouse/client";
import type { Redis as RedisType } from "ioredis";
import type { preHandlerHookHandler } from "fastify";

import { PrismaClient } from "../generated/prisma/client.js";
import type { AppContext } from "../lib/context.js";
import type { ResolvedSite, SiteRole } from "../plugins/site-access.plugin.js";
import type { FeatureKey } from "../core/billing/catalog/entitlements.schema.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
    optionalAuthenticate: preHandlerHookHandler;
    authorizeSite: preHandlerHookHandler;
    /** Plan feature gate; see plugins/entitlement.plugin.ts. */
    requireEntitlement: (feature: FeatureKey) => preHandlerHookHandler;
    invalidateSiteCache: (siteId: string) => Promise<void>;
    prisma: PrismaClient;
    redis: RedisType;
    clickhouse: ReturnType<typeof createClient>;
  }
  interface FastifyRequest {
    session: {
      userId: string;
      email: string;
      name: string;
      sessionId: string;
    };
    website: ResolvedSite;
    /** Set by authorizeSite alongside `website`. */
    siteRole: SiteRole;
    ctx: AppContext;
    /**
     * How the request was authenticated. Absent until `authenticate` or
     * `optionalAuthenticate` has run and found credentials. API-key requests
     * are read-only; see plugins/auth.plugin.ts.
     */
    auth?: { kind: "session" } | { kind: "api_key"; apiKeyId: string };
  }
}
