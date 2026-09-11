import type { Entitlements } from "./entitlements.schema.js";
import type { PlanCode } from "./billing.config.js";

/**
 * The plan catalog. This file is the only place plan limits, prices and
 * entitlements are written down. `prisma/seed.ts` copies it into the `plans`
 * table, the API serves that table, and both front ends render from the API.
 *
 * These are the approved prices (9 Sep 2026); BILLING_CONFIG.pricingFinal says
 * so. A change here is a pricing decision: the seed rewrites the plans table,
 * but existing provider prices are immutable once sold, so the Paddle setup
 * script creates a new price and repoints the row rather than editing one.
 *
 * Money is in cents. overagePricePer1k null means a hard limit (no overage,
 * traffic pauses at the limit). A number means pay as you go up to the spend cap.
 */
export type PlanDefinition = {
  code: PlanCode;
  name: string;
  description: string;
  monthlyPrice: number;
  overagePricePer1k: number | null;
  isPublic: boolean;
  entitlements: Entitlements;
};

export const PLAN_CATALOG: readonly PlanDefinition[] = [
  {
    code: "free",
    name: "Free",
    description: "For personal sites and trying Webyz out. Pauses at the limit, never bills.",
    monthlyPrice: 0,
    overagePricePer1k: null,
    isPublic: true,
    entitlements: {
      sites: 1,
      events_per_period: 10_000,
      retention_days: 90,
      team_members: 1,
      realtime: true,
      goals: true,
      funnels: false,
      journeys: false,
      search_console: false,
      public_dashboards: true,
      custom_events: true,
      api_access: false,
      exports: false,
    },
  },
  {
    code: "starter",
    name: "Starter",
    description: "For a few small sites that have outgrown the free limit.",
    monthlyPrice: 900,
    overagePricePer1k: 3,
    isPublic: true,
    entitlements: {
      sites: 3,
      events_per_period: 100_000,
      retention_days: 365,
      team_members: 1,
      realtime: true,
      goals: true,
      funnels: true,
      journeys: false,
      search_console: true,
      public_dashboards: true,
      custom_events: true,
      api_access: false,
      exports: true,
    },
  },
  {
    code: "growth",
    name: "Growth",
    description: "For growing businesses that need every report and more headroom.",
    monthlyPrice: 1_900,
    overagePricePer1k: 2,
    isPublic: true,
    entitlements: {
      sites: 10,
      events_per_period: 500_000,
      retention_days: 730,
      team_members: 5,
      realtime: true,
      goals: true,
      funnels: true,
      journeys: true,
      search_console: true,
      public_dashboards: true,
      custom_events: true,
      api_access: true,
      exports: true,
    },
  },
  {
    code: "business",
    name: "Business",
    description: "For teams running many high traffic sites.",
    monthlyPrice: 4_900,
    overagePricePer1k: 1,
    isPublic: true,
    entitlements: {
      sites: 25,
      events_per_period: 2_000_000,
      retention_days: 1_095,
      team_members: 15,
      realtime: true,
      goals: true,
      funnels: true,
      journeys: true,
      search_console: true,
      public_dashboards: true,
      custom_events: true,
      api_access: true,
      exports: true,
    },
  },
];
