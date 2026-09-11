import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { assertFeature } from "../core/billing/entitlements/entitlement.guard.js";
import type { FeatureKey } from "../core/billing/catalog/entitlements.schema.js";
import { unauthorized } from "../errors/http-errors.js";

/**
 * `fastify.requireEntitlement(feature)`: a preHandler that rejects with
 * FEATURE_NOT_AVAILABLE (403) unless the plan of the account in scope
 * includes the feature.
 *
 * Whose plan: when `authorizeSite` has run, the site's owner (so a public
 * dashboard shows the owner's features, and a viewer's own plan is
 * irrelevant); otherwise the authenticated user, whose ownership of the site
 * the controller then checks with getOwnedWebsite. Put it after
 * `authenticate` / `authorizeSite` in the preHandler list.
 */
const entitlementPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate(
    "requireEntitlement",
    (feature: FeatureKey) =>
      async (request: FastifyRequest, _reply: FastifyReply) => {
        const ownerId = request.website?.userId ?? request.session?.userId;
        if (!ownerId) throw unauthorized("Authentication required");
        await assertFeature(request.ctx, ownerId, feature);
      },
  );
};

export default fp(entitlementPlugin);
