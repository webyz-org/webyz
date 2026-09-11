import { FastifyReply, FastifyRequest } from "fastify";

import { sendResponse } from "../http/helper/send-response.js";
import { resolveRetainedWindow, retentionMeta } from "../core/billing/entitlements/retention.js";
import { getAccessibleWebsite, getManagedWebsite } from "../core/website/website.service.js";
import { getGoalDetail } from "../core/analytics/goals.service.js";
import {
  FunnelInput,
  createFunnel,
  deleteFunnel,
  getFunnelAnalysis,
  listFunnels,
  updateFunnel,
} from "../core/analytics/funnels.service.js";

/**
 * Funnels and goal detail. Reads need access to the site (owner or member),
 * definitions need the owner or an admin - definitions and
 * conversion breakdowns are management views, never part of public shares.
 */

type SiteParams = { siteId: string };
type FunnelParams = SiteParams & { funnelId: string };

type PeriodQuery = {
  period?: string;
  date?: string;
  from?: string;
  to?: string;
};

const resolveOwnedWindow = async (
  request: FastifyRequest<{ Params: SiteParams }>,
) => {
  const website = await getAccessibleWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );
  // Cut to the owner's retention like every other analytics read.
  const range = await resolveRetainedWindow(request.ctx, {
    ownerId: website.userId,
    timezone: website.timezone,
    query: request.query as PeriodQuery,
    defaultPeriod: "last_28_days",
  });
  return { website, range };
};

// ─── Funnels ──────────────────────────────────────────────────────────────────

export const listFunnelsController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const website = await getAccessibleWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );
  const funnels = await listFunnels(request.ctx, website.id);
  return sendResponse(reply, funnels);
};

export const createFunnelController = async (
  request: FastifyRequest<{ Params: SiteParams; Body: FunnelInput }>,
  reply: FastifyReply,
) => {
  const website = await getManagedWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );
  const funnel = await createFunnel(request.ctx, website.id, request.body);
  return sendResponse(reply, funnel, { statusCode: 201 });
};

export const updateFunnelController = async (
  request: FastifyRequest<{ Params: FunnelParams; Body: FunnelInput }>,
  reply: FastifyReply,
) => {
  const website = await getManagedWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );
  const funnel = await updateFunnel(
    request.ctx,
    website.id,
    request.params.funnelId,
    request.body,
  );
  return sendResponse(reply, funnel);
};

export const deleteFunnelController = async (
  request: FastifyRequest<{ Params: FunnelParams }>,
  reply: FastifyReply,
) => {
  const website = await getManagedWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );
  await deleteFunnel(request.ctx, website.id, request.params.funnelId);
  return sendResponse(reply, { deleted: true });
};

export const getFunnelAnalysisController = async (
  request: FastifyRequest<{ Params: FunnelParams }>,
  reply: FastifyReply,
) => {
  const { website, range } = await resolveOwnedWindow(request);
  const query = request.query as PeriodQuery & { metric?: string };

  const data = await getFunnelAnalysis(request.ctx, {
    websiteId: website.id,
    funnelId: request.params.funnelId,
    from: range.from,
    to: range.to,
    metric: query.metric === "sessions" ? "sessions" : "visitors",
  });

  return sendResponse(reply, data, { meta: retentionMeta(range) });
};

// ─── Goal detail ──────────────────────────────────────────────────────────────

export const getGoalDetailController = async (
  request: FastifyRequest<{ Params: SiteParams & { goalId: string } }>,
  reply: FastifyReply,
) => {
  const { website, range } = await resolveOwnedWindow(request);

  const data = await getGoalDetail(request.ctx, {
    websiteId: website.id,
    goalId: request.params.goalId,
    from: range.from,
    to: range.to,
    timezone: website.timezone,
  });

  return sendResponse(reply, data);
};
