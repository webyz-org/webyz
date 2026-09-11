import { API_URL } from "../config/site";

/** Mirrors the API's plan entitlements JSON. Keys are owned by the API catalog. */
export type Entitlements = {
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

export type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  sortOrder: number;
  eventLimit: number;
  overagePricePer1k: number | null;
  dataRetentionDays: number;
  websiteLimit: number;
  isFree: boolean;
  /** False until the payment provider is configured and the plan has a price. */
  purchasable: boolean;
  entitlements: Entitlements;
};

export type PlansResponse = {
  plans: Plan[];
  /** "placeholder" until pricing is approved; the page labels it accordingly. */
  pricingStatus: "final" | "placeholder";
  /** Whether any paid plan can be bought right now, and what a new account gets instead. */
  billing: {
    purchasable: boolean;
    trial: { days: number; planCode: string } | null;
  };
};

export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

export const compact = (value: number) =>
  value >= 1_000_000
    ? `${value / 1_000_000}m`
    : value >= 1000
      ? `${value / 1000}k`
      : String(value);

/**
 * Plans come from the API's public plan list, so the pricing page and in-app
 * billing can never drift apart. The API also says whether the numbers are
 * final. If the API is unreachable the caller renders an honest fallback
 * rather than invented prices.
 */
export async function getPlans(): Promise<PlansResponse | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/plans`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const plans: Plan[] | undefined = body?.data;
    if (!plans) return null;
    return {
      plans: [...plans].sort((a, b) => a.sortOrder - b.sortOrder),
      pricingStatus: body?.meta?.pricing?.status === "final" ? "final" : "placeholder",
      billing: {
        purchasable: Boolean(body?.meta?.billing?.purchasable),
        trial: body?.meta?.billing?.trial ?? null,
      },
    };
  } catch {
    return null;
  }
}
