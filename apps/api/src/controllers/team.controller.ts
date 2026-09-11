import type { FastifyReply, FastifyRequest } from "fastify";

import { sendResponse } from "../http/helper/send-response.js";
import {
  acceptInvitation,
  getInvitation,
  inviteMember,
  listMembers,
  removeMember,
  revokeInvitation,
  updateMemberRole,
} from "../core/website/members.service.js";
import type { WebsiteRole } from "../generated/prisma/client.js";

type SiteParams = { siteId: string };

export const listMembersController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  const data = await listMembers(request.ctx, request.session.userId, request.params.siteId);
  return sendResponse(reply, data);
};

export const inviteMemberController = async (
  request: FastifyRequest<{ Params: SiteParams; Body: { email: string; role: WebsiteRole } }>,
  reply: FastifyReply,
) => {
  const invitation = await inviteMember(
    request.ctx,
    request.session.userId,
    request.params.siteId,
    request.body,
  );
  return sendResponse(reply, invitation, { statusCode: 201 });
};

export const revokeInvitationController = async (
  request: FastifyRequest<{ Params: SiteParams & { invitationId: string } }>,
  reply: FastifyReply,
) => {
  await revokeInvitation(
    request.ctx,
    request.session.userId,
    request.params.siteId,
    request.params.invitationId,
  );
  return sendResponse(reply, { revoked: true });
};

export const updateMemberRoleController = async (
  request: FastifyRequest<{ Params: SiteParams & { memberId: string }; Body: { role: WebsiteRole } }>,
  reply: FastifyReply,
) => {
  const member = await updateMemberRole(
    request.ctx,
    request.session.userId,
    request.params.siteId,
    request.params.memberId,
    request.body.role,
  );
  // Roles ride on the cached site record the access plugin reads.
  await request.server.invalidateSiteCache(request.params.siteId);
  return sendResponse(reply, { id: member.id, role: member.role });
};

export const removeMemberController = async (
  request: FastifyRequest<{ Params: SiteParams & { memberId: string } }>,
  reply: FastifyReply,
) => {
  await removeMember(
    request.ctx,
    request.session.userId,
    request.params.siteId,
    request.params.memberId,
  );
  await request.server.invalidateSiteCache(request.params.siteId);
  return sendResponse(reply, { removed: true });
};

export const getInvitationController = async (
  request: FastifyRequest<{ Params: { token: string } }>,
  reply: FastifyReply,
) => {
  const invitation = await getInvitation(request.ctx, request.params.token);
  return sendResponse(reply, invitation);
};

export const acceptInvitationController = async (
  request: FastifyRequest<{ Params: { token: string } }>,
  reply: FastifyReply,
) => {
  const result = await acceptInvitation(request.ctx, request.session.userId, request.params.token);
  await request.server.invalidateSiteCache(result.websiteId);
  return sendResponse(reply, result);
};
