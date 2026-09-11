export type Plan = {
  id: string;
  name: string;
  description: string | null;
  monthlyPrice: number; // cents
  yearlyPrice: number; // cents
  eventLimit: number;
  /** Cents per 1,000 overage events; null means a hard limit. */
  overagePricePer1k: number | null;
  /** Deprecated mirror of overagePricePer1k * 100. */
  extraPricePer100k: number | null;
  dataRetentionDays: number;
  websiteLimit: number;
  isFree: boolean;
  isActive: boolean;
  isPublic: boolean;
  // Public provider price ids. Null until the plan is wired up at the payment
  // provider, and a plan without one cannot be purchased yet.
  providerPriceMonthlyId: string | null;
  providerPriceYearlyId: string | null;
  /** From the API: provider configured and a price id present. */
  purchasable: boolean;
  sortOrder: number;
  entitlements: {
    sites: number;
    events_per_period: number;
    retention_days: number;
    team_members: number;
    realtime: boolean;
    goals: boolean;
    funnels: boolean;
    journeys: boolean;
    search_console: boolean;
    public_dashboards: boolean;
    custom_events: boolean;
    api_access: boolean;
    exports: boolean;
  };
};

export type InvoiceRow = {
  id: string;
  number: string | null;
  status: string;
  reason: string | null;
  createdAt: string;
  totalCents: number;
  amountPaidCents: number;
  currency: string;
  hostedUrl: string | null;
  pdfUrl: string | null;
};

/** GET /billing/usage. Everything derived server side; the UI only renders. */
export type UsageSummary = {
  plan: {
    id: string;
    code: string;
    name: string;
    isFree: boolean;
    overagePricePer1k: number | null;
    /** What the plan includes. The API enforces it; the UI only uses it to hide and explain. */
    entitlements: Plan["entitlements"];
  };
  subscription: {
    id: string;
    status: string;
    billingCycle: "MONTHLY" | "YEARLY";
    cancelAtPeriodEnd: boolean;
    cancelAt: string | null;
    trialEndsAt: string | null;
    graceEndsAt: string | null;
  } | null;
  access: {
    state: "FREE" | "TRIAL" | "PAID" | "GRACE" | "RESTRICTED" | "ENDED";
    ingestAllowed: boolean;
    dashboardAllowed: boolean;
    reason: string | null;
    until: string | null;
  };
  pendingChange: { planId: string; planName: string; billingCycle: "MONTHLY" | "YEARLY"; effectiveAt: string } | null;
  trial: {
    planName: string;
    startsAt: string | null;
    endsAt: string;
    daysRemaining: number;
    fallbackPlanName: string;
  } | null;
  spendCap: {
    applies: boolean;
    capCents: number | null;
    minCents: number | null;
    maxCents: number | null;
    defaultCents: number | null;
    isDefault: boolean;
    pendingCents: number | null;
    monthlyBaseCents: number;
  };
  sites: {
    limit: number;
    active: number;
    inactive: { id: string; domain: string; reason: string | null }[];
  };
  base: {
    cycle: "MONTHLY" | "YEARLY";
    priceCents: number;
    monthlyEquivalentCents: number;
    periodStart: string | null;
    periodEnd: string | null;
  };
  period: { start: string | null; end: string | null; elapsedPercent: number };
  usage: {
    totalEvents: number;
    includedEvents: number;
    overageEvents: number;
    remainingIncluded: number;
    usageRatio: number | null;
    overageUnits: number;
    overageCents: number;
    currentBillCents: number;
    periodChargesCents: number;
    isPayAsYouGo: boolean;
    spendCapCents: number | null;
    capRemainingCents: number | null;
    capReached: boolean;
    capApproaching: boolean;
    projectedEvents: number;
    projectedBillCents: number;
    lastComputedAt: string | null;
  };
};

export type CurrentPlan = {
  plan: Plan;
  subscription: {
    id: string;
    status: string;
    billingCycle: "MONTHLY" | "YEARLY";
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  usage: {
    totalEvents: number;
    eventLimit: number;
    periodStart: string | null;
    periodEnd: string | null;
  };
};

export type ChangePreview = {
  kind: "upgrade" | "downgrade" | "same";
  effective: "now" | "base_period_end";
  effectiveAt: string | null;
  from: { planId: string; code: string; name: string; cycle: "MONTHLY" | "YEARLY"; priceCents: number };
  to: { planId: string; code: string; name: string; cycle: "MONTHLY" | "YEARLY"; priceCents: number };
  diff: {
    limits: { key: string; label: string; from: number; to: number }[];
    featuresGained: { key: string; label: string }[];
    featuresLost: { key: string; label: string }[];
  };
  sites: { total: number; limitAfter: number; wouldGoInactive: { id: string; domain: string }[]; wouldReactivate: { id: string; domain: string }[] };
  notes: string[];
};

export type CancelPreview = {
  accessUntil: string | null;
  cycle: "MONTHLY" | "YEARLY";
  planName: string;
  fallbackPlanName: string;
  fallback: { sites: number; eventsPerPeriod: number; retentionDays: number };
  sitesThatWouldGoInactive: { id: string; domain: string }[];
  featuresLost: { key: string; label: string }[];
  notes: string[];
};
