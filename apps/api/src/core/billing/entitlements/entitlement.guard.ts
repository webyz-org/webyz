import type { AppContext } from "../../../lib/context.js";
import { featureNotAvailable } from "../../../errors/domain-errors.js";
import type { FeatureKey, LimitKey } from "../catalog/entitlements.schema.js";
import { getEntitlements, hasFeature, type ResolvedEntitlements } from "./entitlement.service.js";

/**
 * The one place a feature entitlement is turned into an allow-or-deny.
 *
 * The catalog (catalog/plans.config.ts) says what each plan includes;
 * `getEntitlements` says which plan an account is on right now, through the
 * live subscription (a trial counts, a canceled one does not, a restricted
 * paid one still does: ingest restriction and feature access are separate
 * concerns, see state/restriction.ts). Nothing here looks at a plan name.
 *
 * Routes use the Fastify decorator `requireEntitlement(feature)`
 * (plugins/entitlement.plugin.ts); services that cannot go through a route
 * preHandler call `assertFeature` directly.
 */

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  realtime: "Realtime dashboard",
  goals: "Goals and conversions",
  funnels: "Funnels",
  journeys: "User journeys",
  search_console: "Google Search Console",
  public_dashboards: "Public dashboards",
  custom_events: "Custom events",
  api_access: "API access",
  exports: "Data export",
};

export const LIMIT_LABELS: Record<LimitKey, string> = {
  sites: "websites",
  events_per_period: "events per month",
  retention_days: "days of history",
  team_members: "team members",
};

/**
 * Resolve the account's entitlements and throw FEATURE_NOT_AVAILABLE (403)
 * unless the plan includes `feature`. Returns the resolved entitlements so a
 * caller can go on to read limits without a second lookup.
 */
export const assertFeature = async (
  ctx: Pick<AppContext, "prisma" | "redis">,
  userId: string,
  feature: FeatureKey,
): Promise<ResolvedEntitlements> => {
  const resolved = await getEntitlements(ctx, userId);
  if (!hasFeature(resolved.entitlements, feature)) {
    throw featureNotAvailable({ feature, label: FEATURE_LABELS[feature], plan: resolved.planName });
  }
  return resolved;
};
