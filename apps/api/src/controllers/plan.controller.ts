import { FastifyReply, FastifyRequest } from "fastify";

import { sendResponse } from "../http/helper/send-response.js";
import {
  createPlan,
  deactivatePlan,
  getAllActivePlans,
  getPlanById,
  getUserPlan,
  updatePlan,
} from "../core/plan/plan.service.js";
import { notFound } from "../errors/http-errors.js";
import { BILLING_CONFIG } from "../core/billing/catalog/billing.config.js";
import { BILLING_ENABLED } from "../config/env.js";

export const createPlanController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const plan = await createPlan(request.ctx, request.body as any);
  return sendResponse(reply, plan, { statusCode: 201 });
};

export const updatePlanController = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  const plan = await updatePlan(
    request.ctx,
    request.params.id,
    request.body as any,
  );
  return sendResponse(reply, plan);
};

/**
 * Public plan list. Two facts ride with it so neither front end has to guess:
 *
 *  - `meta.pricing.status`: "final" once pricing is approved, "placeholder"
 *    while the numbers are modelling values, so the page can label them.
 *  - `purchasable` per plan and `meta.billing`: a plan can be bought only when
 *    the payment provider is configured and the plan has a price id. Until
 *    then the pricing page and the billing page say so instead of offering a
 *    checkout that would fail, and describe what a new account gets instead
 *    (the trial). Both light up automatically once the provider is wired.
 */
export const getPlansController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const rows = await getAllActivePlans(request.ctx);
  const plans = rows.map((plan) => ({
    ...plan,
    purchasable: !plan.isFree && BILLING_ENABLED && Boolean(plan.providerPriceMonthlyId),
  }));
  return sendResponse(reply, plans, {
    meta: {
      pricing: {
        status: BILLING_CONFIG.pricingFinal ? "final" : "placeholder",
        currency: BILLING_CONFIG.currency,
        meterUnitEvents: BILLING_CONFIG.usage.meterUnitEvents,
      },
      billing: {
        enabled: BILLING_ENABLED,
        purchasable: plans.some((p) => p.purchasable),
        trial: BILLING_CONFIG.trial.enabled
          ? { days: BILLING_CONFIG.trial.days, planCode: BILLING_CONFIG.trial.planCode }
          : null,
      },
    },
  });
};

export const getPlanController = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  const plan = await getPlanById(request.ctx, request.params.id);
  if (!plan) throw notFound("Plan not found");
  return sendResponse(reply, plan);
};

export const deactivatePlanController = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  const plan = await deactivatePlan(request.ctx, request.params.id);
  return sendResponse(reply, plan);
};

export const getCurrentUserPlanController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const data = await getUserPlan(request.ctx, request.session.userId);
  return sendResponse(reply, data);
};
