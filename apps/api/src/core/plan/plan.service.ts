import { AppContext } from "../../lib/context.js";
import { notFound } from "../../errors/http-errors.js";

export interface CreatePlanInput {
  /** Stable slug, unique. Prefer editing the catalog over creating plans ad hoc. */
  code: string;
  name: string;
  description?: string;
  monthlyPrice: number;
  yearlyPrice: number;
  eventLimit: number;
  extraPricePer100k?: number | null;
  dataRetentionDays?: number;
  websiteLimit?: number;
  providerPriceMonthlyId?: string;
  providerPriceYearlyId?: string;
  isFree?: boolean;
  isPublic?: boolean;
}

export const createPlan = async (
  { prisma }: AppContext,
  data: CreatePlanInput,
) => {
  if (data.isFree) {
    const existingFree = await prisma.plan.findFirst({
      where: { isFree: true },
    });
    if (existingFree) {
      throw new Error("Free plan already exists");
    }
  }

  return prisma.plan.create({ data });
};

export const updatePlan = async (
  { prisma }: AppContext,
  planId: string,
  data: Partial<CreatePlanInput>,
) => {
  return prisma.plan.update({ where: { id: planId }, data });
};

/** Publicly listable plans, cheapest first. */
export const getAllActivePlans = async ({ prisma }: AppContext) => {
  return prisma.plan.findMany({
    where: { isActive: true, isPublic: true },
    orderBy: { monthlyPrice: "asc" },
  });
};

export const getPlanById = async ({ prisma }: AppContext, planId: string) => {
  return prisma.plan.findUnique({ where: { id: planId } });
};

export const deactivatePlan = async (
  { prisma }: AppContext,
  planId: string,
) => {
  return prisma.plan.update({
    where: { id: planId },
    data: { isActive: false },
  });
};

/**
 * A user's effective plan. There is no User->Plan relation; the plan is reached
 * through the newest non-terminal subscription. Users with no subscription fall
 * back to the free plan so quota checks always have something to read.
 */
export const getUserPlan = async ({ prisma }: AppContext, userId: string) => {
  const subscription = await prisma.subscription.findFirst({
    where: { userId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    orderBy: { createdAt: "desc" },
    include: {
      plan: true,
      billingPeriodUsages: { orderBy: { periodStart: "desc" }, take: 1 },
    },
  });

  if (subscription) {
    const usage = subscription.billingPeriodUsages[0];
    return {
      plan: subscription.plan,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        billingCycle: subscription.billingCycle,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
      usage: {
        totalEvents: Number(usage?.totalEvents ?? 0),
        eventLimit: subscription.plan.eventLimit,
        periodStart: usage?.periodStart ?? subscription.currentPeriodStart,
        periodEnd: usage?.periodEnd ?? subscription.currentPeriodEnd,
      },
    };
  }

  const freePlan = await prisma.plan.findFirst({ where: { isFree: true } });
  if (!freePlan) throw notFound("No free plan configured");

  return {
    plan: freePlan,
    subscription: null,
    usage: {
      totalEvents: 0,
      eventLimit: freePlan.eventLimit,
      periodStart: null,
      periodEnd: null,
    },
  };
};
