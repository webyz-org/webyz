import { AppContext } from "../../lib/context.js";
import {
  FunnelStepCondition,
  funnelAnalysisQuery,
} from "../../db/clickhouse/funnels.js";
import { calculatePercentage } from "./helpers.js";
import { badRequest, notFound } from "../../errors/http-errors.js";

/**
 * Funnel definitions live in Postgres; the analysis is computed live in
 * ClickHouse per request (db/clickhouse/funnels.ts holds the semantics).
 */

export const FUNNEL_MIN_STEPS = 2;
export const FUNNEL_MAX_STEPS = 8;

export type FunnelStepInput = {
  label?: string;
  eventName?: string;
  pagePath?: string;
};

export type FunnelInput = {
  name: string;
  steps: FunnelStepInput[];
};

const validateFunnelInput = (input: FunnelInput) => {
  const name = input.name?.trim();
  if (!name || name.length > 120) {
    throw badRequest("Funnel name must be 1-120 characters");
  }

  const steps = input.steps ?? [];
  if (steps.length < FUNNEL_MIN_STEPS || steps.length > FUNNEL_MAX_STEPS) {
    throw badRequest(
      `A funnel needs between ${FUNNEL_MIN_STEPS} and ${FUNNEL_MAX_STEPS} steps`,
    );
  }

  return {
    name,
    steps: steps.map((step, i) => {
      const eventName = step.eventName?.trim();
      const pagePath = step.pagePath?.trim();
      if (Boolean(eventName) === Boolean(pagePath)) {
        throw badRequest(
          `Step ${i + 1} must set exactly one of eventName or pagePath`,
        );
      }
      return {
        position: i + 1,
        label: step.label?.trim().slice(0, 120) ?? "",
        eventName: eventName || null,
        pagePath: pagePath || null,
      };
    }),
  };
};

const funnelInclude = {
  steps: { orderBy: { position: "asc" as const } },
};

export const listFunnels = ({ prisma }: AppContext, websiteId: string) =>
  prisma.funnel.findMany({
    where: { websiteId },
    orderBy: { createdAt: "asc" },
    include: funnelInclude,
  });

const getFunnel = async (
  { prisma }: AppContext,
  websiteId: string,
  funnelId: string,
) => {
  const funnel = await prisma.funnel.findFirst({
    where: { id: funnelId, websiteId },
    include: funnelInclude,
  });
  if (!funnel) throw notFound("Funnel not found");
  return funnel;
};

export const createFunnel = async (
  ctx: AppContext,
  websiteId: string,
  input: FunnelInput,
) => {
  const { name, steps } = validateFunnelInput(input);

  return ctx.prisma.funnel.create({
    data: { websiteId, name, steps: { create: steps } },
    include: funnelInclude,
  });
};

/** Steps are replaced wholesale: a funnel edit is a redefinition, not a patch. */
export const updateFunnel = async (
  ctx: AppContext,
  websiteId: string,
  funnelId: string,
  input: FunnelInput,
) => {
  await getFunnel(ctx, websiteId, funnelId);
  const { name, steps } = validateFunnelInput(input);

  const [, funnel] = await ctx.prisma.$transaction([
    ctx.prisma.funnelStep.deleteMany({ where: { funnelId } }),
    ctx.prisma.funnel.update({
      where: { id: funnelId },
      data: { name, steps: { create: steps } },
      include: funnelInclude,
    }),
  ]);

  return funnel;
};

export const deleteFunnel = async (
  ctx: AppContext,
  websiteId: string,
  funnelId: string,
) => {
  await getFunnel(ctx, websiteId, funnelId);
  await ctx.prisma.funnel.delete({ where: { id: funnelId } });
};

export type FunnelStepResult = {
  position: number;
  label: string;
  event_name: string | null;
  page_path: string | null;
  visitors: number;
  sessions: number;
  /** Of the selected metric, vs step 1. */
  conversion_rate: number;
  /** Of the selected metric, lost vs the previous step. */
  drop_off: number;
};

export const getFunnelAnalysis = async (
  ctx: AppContext,
  input: {
    websiteId: string;
    funnelId: string;
    from: number;
    to: number;
    metric: "visitors" | "sessions";
  },
) => {
  const funnel = await getFunnel(ctx, input.websiteId, input.funnelId);

  const conditions: FunnelStepCondition[] = funnel.steps.map((s) => ({
    eventName: s.eventName,
    pagePath: s.pagePath,
  }));

  const counts = await funnelAnalysisQuery(ctx.clickhouse, {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    steps: conditions,
  });

  const metricCounts =
    input.metric === "sessions" ? counts.sessions : counts.visitors;
  const entered = metricCounts[0] ?? 0;

  const steps: FunnelStepResult[] = funnel.steps.map((step, i) => {
    const current = metricCounts[i] ?? 0;
    const previous = i === 0 ? current : (metricCounts[i - 1] ?? 0);
    return {
      position: step.position,
      label: step.label || step.eventName || step.pagePath || "",
      event_name: step.eventName,
      page_path: step.pagePath,
      visitors: counts.visitors[i] ?? 0,
      sessions: counts.sessions[i] ?? 0,
      conversion_rate: calculatePercentage(current, entered, 1),
      drop_off: i === 0 ? 0 : calculatePercentage(previous - current, previous, 1),
    };
  });

  return {
    funnel: { id: funnel.id, name: funnel.name },
    metric: input.metric,
    entered,
    completed: metricCounts[metricCounts.length - 1] ?? 0,
    conversion_rate: calculatePercentage(
      metricCounts[metricCounts.length - 1] ?? 0,
      entered,
      1,
    ),
    steps,
  };
};
