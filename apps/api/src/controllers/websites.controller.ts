import { FastifyReply, FastifyRequest } from "fastify";

import { sendResponse } from "../http/helper/send-response.js";
import {
  CreateWebsiteInput,
  UpdateWebsiteInput,
  createWebsite,
  deleteWebsite,
  disableSharing,
  enableSharing,
  getAccessibleWebsite,
  getInstallStatus,
  getManagedWebsite,
  getWebsiteBySlug,
  listWebsites,
  updateWebsite,
} from "../core/website/website.service.js";
import {
  clearSharePassword,
  setSharePassword,
  unlockSharedWebsite,
} from "../core/website/share-password.service.js";
import {
  createGoal,
  deleteGoal,
  listGoals,
} from "../core/analytics/goals.service.js";
import { FRONTEND_URL } from "../config/env.js";
import { chooseActiveSites } from "../core/billing/subscription/site-limit.service.js";

/** The customer decides which sites stay active within the plan's site limit. */
export const setActiveWebsitesController = async (
  request: FastifyRequest<{ Body: { activeIds: string[] } }>,
  reply: FastifyReply,
) => {
  const result = await chooseActiveSites(request.ctx, request.session.userId, request.body.activeIds);
  return sendResponse(reply, result);
};

type SiteParams = { siteId: string };

/**
 * A site row as the dashboard sees it. The share password hash stays on the
 * server: only the fact that one is set crosses the wire.
 */
const serializeWebsite = <T extends { sharePasswordHash?: string | null }>(website: T) => {
  const { sharePasswordHash, ...rest } = website;
  return { ...rest, hasPassword: Boolean(sharePasswordHash) };
};

export const createWebsiteController = async (
  request: FastifyRequest<{ Body: CreateWebsiteInput }>,
  reply: FastifyReply,
) => {
  const website = await createWebsite(
    request.ctx,
    request.session.userId,
    request.body,
  );

  return sendResponse(reply, serializeWebsite(website), { statusCode: 201 });
};

export const listWebsitesController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const websites = await listWebsites(request.ctx, request.session.userId);
  return sendResponse(reply, websites.map(serializeWebsite));
};

export const getWebsiteController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const website = await getManagedWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );

  return sendResponse(reply, serializeWebsite(website));
};

export const getInstallStatusController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const status = await getInstallStatus(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );

  return sendResponse(reply, status);
};

export const updateWebsiteController = async (
  request: FastifyRequest<{ Params: SiteParams; Body: UpdateWebsiteInput }>,
  reply: FastifyReply,
) => {
  const website = await updateWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
    request.body,
  );

  // The site-access cache holds timezone and visibility, so it has to go.
  await request.server.invalidateSiteCache(request.params.siteId);

  return sendResponse(reply, serializeWebsite(website));
};

export const deleteWebsiteController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  await deleteWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );
  await request.server.invalidateSiteCache(request.params.siteId);

  return sendResponse(reply, { deleted: true });
};

// The public dashboard route lives in the app (/share/:slug), not on the
// marketing site, which may not even be deployed.
const shareUrl = (slug: string | null) =>
  slug ? `${FRONTEND_URL}/share/${slug}` : null;

/** The one shape every sharing mutation answers with. */
const shareState = (website: {
  isPublic: boolean;
  publicSlug: string | null;
  sharePasswordHash: string | null;
}) => ({
  isPublic: website.isPublic,
  publicSlug: website.isPublic ? website.publicSlug : null,
  shareUrl: website.isPublic ? shareUrl(website.publicSlug) : null,
  hasPassword: website.isPublic && website.sharePasswordHash !== null,
});

export const enableSharingController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const website = await enableSharing(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );
  await request.server.invalidateSiteCache(request.params.siteId);

  return sendResponse(reply, shareState(website));
};

export const disableSharingController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const website = await disableSharing(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );
  await request.server.invalidateSiteCache(request.params.siteId);

  return sendResponse(reply, shareState(website));
};

/** Set or replace the share password. Tokens minted under the old one stop working. */
export const setSharePasswordController = async (
  request: FastifyRequest<{ Params: SiteParams; Body: { password: string } }>,
  reply: FastifyReply,
) => {
  const website = await setSharePassword(
    request.ctx,
    request.session.userId,
    request.params.siteId,
    request.body.password,
  );
  // The plugin caches the hash alongside visibility.
  await request.server.invalidateSiteCache(request.params.siteId);

  return sendResponse(reply, shareState(website));
};

export const clearSharePasswordController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const website = await clearSharePassword(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );
  await request.server.invalidateSiteCache(request.params.siteId);

  return sendResponse(reply, shareState(website));
};

/** Public: resolve a shared link into the site id the dashboard should load. */
export const getSharedWebsiteController = async (
  request: FastifyRequest<{ Params: { slug: string } }>,
  reply: FastifyReply,
) => {
  const website = await getWebsiteBySlug(request.ctx, request.params.slug);
  return sendResponse(reply, website);
};

/** Public: trade the share password for a token the dashboard sends on every read. */
export const unlockSharedWebsiteController = async (
  request: FastifyRequest<{ Params: { slug: string }; Body: { password: string } }>,
  reply: FastifyReply,
) => {
  const result = await unlockSharedWebsite(
    request.ctx,
    request.params.slug,
    request.body.password,
  );
  return sendResponse(reply, result);
};

// ─── Goals ────────────────────────────────────────────────────────────────────

export const listGoalsController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  await getAccessibleWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );

  const goals = await listGoals(request.ctx, request.params.siteId);
  return sendResponse(reply, goals);
};

export const createGoalController = async (
  request: FastifyRequest<{
    Params: SiteParams;
    Body: { name: string; eventName?: string; pagePath?: string };
  }>,
  reply: FastifyReply,
) => {
  await getManagedWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );

  const goal = await createGoal(
    request.ctx,
    request.params.siteId,
    request.body,
  );

  return sendResponse(reply, goal, { statusCode: 201 });
};

export const deleteGoalController = async (
  request: FastifyRequest<{ Params: SiteParams & { goalId: string } }>,
  reply: FastifyReply,
) => {
  await getManagedWebsite(
    request.ctx,
    request.session.userId,
    request.params.siteId,
  );

  await deleteGoal(request.ctx, request.params.siteId, request.params.goalId);
  return sendResponse(reply, { deleted: true });
};
