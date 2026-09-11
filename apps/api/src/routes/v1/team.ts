import type { FastifyInstance } from "fastify";

import {
  acceptInvitationController,
  getInvitationController,
  inviteMemberController,
  listMembersController,
  removeMemberController,
  revokeInvitationController,
  updateMemberRoleController,
} from "../../controllers/team.controller.js";
import type { WebsiteRole } from "../../generated/prisma/client.js";

type SiteParams = { siteId: string };

const roleSchema = { type: "string", enum: ["ADMIN", "VIEWER"] };

/**
 * Team members per site. Reads are open to anyone with access to the site;
 * changes need the owner or an admin, which the service checks. Invitations
 * are resolved by token: reading one needs no session (the accept page must
 * tell a signed-out visitor which account to use), accepting does.
 */
export default async function teamRoutes(fastify: FastifyInstance) {
  const signedIn = { preHandler: [fastify.authenticate] };

  fastify.get<{ Params: SiteParams }>("/websites/:siteId/members", signedIn, listMembersController);

  fastify.post<{ Params: SiteParams; Body: { email: string; role: WebsiteRole } }>(
    "/websites/:siteId/members/invitations",
    {
      ...signedIn,
      schema: {
        body: {
          type: "object",
          properties: { email: { type: "string", minLength: 3, maxLength: 254 }, role: roleSchema },
          required: ["email", "role"],
          additionalProperties: false,
        },
      },
    },
    inviteMemberController,
  );

  fastify.delete<{ Params: SiteParams & { invitationId: string } }>(
    "/websites/:siteId/members/invitations/:invitationId",
    signedIn,
    revokeInvitationController,
  );

  fastify.patch<{ Params: SiteParams & { memberId: string }; Body: { role: WebsiteRole } }>(
    "/websites/:siteId/members/:memberId",
    {
      ...signedIn,
      schema: {
        body: { type: "object", properties: { role: roleSchema }, required: ["role"], additionalProperties: false },
      },
    },
    updateMemberRoleController,
  );

  fastify.delete<{ Params: SiteParams & { memberId: string } }>(
    "/websites/:siteId/members/:memberId",
    signedIn,
    removeMemberController,
  );

  fastify.get<{ Params: { token: string } }>("/invitations/:token", getInvitationController);
  fastify.post<{ Params: { token: string } }>(
    "/invitations/:token/accept",
    signedIn,
    acceptInvitationController,
  );
}
