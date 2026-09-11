import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/**
 * Everything a plan grants, as one validated object.
 *
 * Limits are integers, features are booleans. Application code asks
 * `getLimit(ents, "sites")` or `hasFeature(ents, "funnels")` and never looks at
 * a plan name or id. Adding a capability means adding a key here and a value to
 * every plan in plans.config.ts; the catalog test fails until both are done.
 */
export const EntitlementsSchema = Type.Object(
  {
    // Limits
    sites: Type.Integer({ minimum: 0 }),
    events_per_period: Type.Integer({ minimum: 0 }),
    retention_days: Type.Integer({ minimum: 1 }),
    team_members: Type.Integer({ minimum: 1 }),

    // Features. Enforced at the API by `requireEntitlement` (see
    // entitlements/entitlement.guard.ts): funnels, journeys, search_console,
    // exports (the CSV export endpoint) and api_access (bearer API keys, checked
    // on creation and on every use in core/auth/api-keys.service.ts).
    // team_members is not enforceable yet because no team model exists.
    // realtime, goals, public_dashboards and custom_events are true on every
    // plan today and are not gated.
    realtime: Type.Boolean(),
    goals: Type.Boolean(),
    funnels: Type.Boolean(),
    journeys: Type.Boolean(),
    search_console: Type.Boolean(),
    public_dashboards: Type.Boolean(),
    custom_events: Type.Boolean(),
    api_access: Type.Boolean(),
    exports: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type Entitlements = Static<typeof EntitlementsSchema>;

export type LimitKey = "sites" | "events_per_period" | "retention_days" | "team_members";
export type FeatureKey = Exclude<keyof Entitlements, LimitKey>;

/**
 * The most restrictive grant possible. Used when a plan row carries invalid or
 * missing JSON so a bad seed degrades to "nothing extra" instead of "everything".
 */
export const MINIMAL_ENTITLEMENTS: Entitlements = {
  sites: 1,
  events_per_period: 0,
  retention_days: 30,
  team_members: 1,
  realtime: false,
  goals: false,
  funnels: false,
  journeys: false,
  search_console: false,
  public_dashboards: false,
  custom_events: false,
  api_access: false,
  exports: false,
};

export const isValidEntitlements = (value: unknown): value is Entitlements =>
  Value.Check(EntitlementsSchema, value);

export const entitlementErrors = (value: unknown): string[] =>
  [...Value.Errors(EntitlementsSchema, value)].map(
    (e) => `${e.path || "/"}: ${e.message}`,
  );

/** Parse a stored JSON value, falling back to the minimal grant if invalid. */
export const parseEntitlements = (value: unknown): Entitlements =>
  isValidEntitlements(value) ? value : MINIMAL_ENTITLEMENTS;

export const getLimit = (ents: Entitlements, key: LimitKey): number => ents[key];

export const hasFeature = (ents: Entitlements, key: FeatureKey): boolean =>
  ents[key];
