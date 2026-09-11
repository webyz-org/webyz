import crypto from "node:crypto";

import { FRONTEND_URL } from "../../config/env.js";
import { badRequest, conflict, notFound } from "../../errors/http-errors.js";
import {
  invitationEmailMismatch,
  invitationExpired,
  teamSeatsExhausted,
} from "../../errors/domain-errors.js";
import type { AppContext } from "../../lib/context.js";
import type { WebsiteRole } from "../../generated/prisma/client.js";
import { getEntitlements } from "../billing/entitlements/entitlement.service.js";
import { getLimit } from "../billing/catalog/entitlements.schema.js";
import { sendEmail } from "../email/email.service.js";
import { invitationEmail } from "../email/templates/index.js";
import { getAccessibleWebsite, getManagedWebsite } from "./website.service.js";

/**
 * Team members: people other than the owner with access to one site.
 *
 * Roles are per site, not per account, because that is how agencies and
 * clients share dashboards: a viewer sees one site, not the account. Plan
 * seats are the owner's (`team_members` on the owner's plan, owner included),
 * since the owner pays, and pending invitations hold a seat so an owner
 * cannot over-invite.
 *
 * Invitations are email links. Only the SHA-256 of the token is stored, the
 * link expires after a week, and accepting requires a signed-in account whose
 * address is the invited one, so a forwarded link admits nobody else.
 */

export const INVITATION_TTL_DAYS = 7;

const ROLES: readonly WebsiteRole[] = ["ADMIN", "VIEWER"];

export const isWebsiteRole = (value: unknown): value is WebsiteRole =>
  typeof value === "string" && (ROLES as readonly string[]).includes(value);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (raw: string): string => {
  const email = raw.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw badRequest(`"${raw}" is not a valid email address`);
  }
  return email;
};

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

const invitationUrl = (token: string) => `${FRONTEND_URL}/invitations/${token}`;

/**
 * How many people may have access to the site, owner included, and how many
 * do (members plus pending invitations). Pure, so the arithmetic is testable.
 */
export const seatUsage = (input: {
  limit: number;
  members: number;
  pendingInvitations: number;
}) => {
  const used = 1 + input.members + input.pendingInvitations;
  return { limit: input.limit, used, available: Math.max(0, input.limit - used) };
};

const seatsFor = async (ctx: AppContext, website: { id: string; userId: string }) => {
  const [{ planName, entitlements }, members, pendingInvitations] = await Promise.all([
    getEntitlements(ctx, website.userId),
    ctx.prisma.websiteMember.count({ where: { websiteId: website.id } }),
    ctx.prisma.websiteInvitation.count({
      where: { websiteId: website.id, expiresAt: { gt: new Date() } },
    }),
  ]);
  return {
    planName,
    ...seatUsage({ limit: getLimit(entitlements, "team_members"), members, pendingInvitations }),
  };
};

const publicUser = { id: true, name: true, email: true, avatarUrl: true } as const;

/** Owner, members and pending invitations of a site, for the People section. */
export const listMembers = async (ctx: AppContext, userId: string, siteId: string) => {
  const website = await getAccessibleWebsite(ctx, userId, siteId);

  const [owner, members, invitations, seats] = await Promise.all([
    ctx.prisma.user.findUnique({ where: { id: website.userId }, select: publicUser }),
    ctx.prisma.websiteMember.findMany({
      where: { websiteId: siteId },
      include: { user: { select: publicUser } },
      orderBy: { createdAt: "asc" },
    }),
    ctx.prisma.websiteInvitation.findMany({
      where: { websiteId: siteId, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    seatsFor(ctx, website),
  ]);

  return {
    role: website.role,
    owner,
    members: members.map((m) => ({
      id: m.id,
      role: m.role,
      createdAt: m.createdAt,
      user: m.user,
    })),
    invitations,
    seats: { limit: seats.limit, used: seats.used, planName: seats.planName },
  };
};

/**
 * Invite by email. Re-inviting an address with a pending invitation refreshes
 * the token and resends, so "the link expired" has an obvious fix.
 */
export const inviteMember = async (
  ctx: AppContext,
  userId: string,
  siteId: string,
  input: { email: string; role: WebsiteRole },
) => {
  const website = await getManagedWebsite(ctx, userId, siteId);
  const email = normalizeEmail(input.email);
  if (!isWebsiteRole(input.role)) throw badRequest("role must be ADMIN or VIEWER");

  const owner = await ctx.prisma.user.findUnique({
    where: { id: website.userId },
    select: { email: true },
  });
  if (owner?.email.toLowerCase() === email) {
    throw conflict("That address belongs to the site owner");
  }

  const existingMember = await ctx.prisma.websiteMember.findFirst({
    where: { websiteId: siteId, user: { email: { equals: email, mode: "insensitive" } } },
  });
  if (existingMember) throw conflict(`${email} already has access to this site`);

  const pending = await ctx.prisma.websiteInvitation.findUnique({
    where: { websiteId_email: { websiteId: siteId, email } },
  });

  // An expired invitation holds no seat (seatsFor ignores it), so re-inviting
  // that address must pass the seat check like a fresh invitation.
  const livePending = pending && pending.expiresAt.getTime() > Date.now();
  if (!livePending) {
    const seats = await seatsFor(ctx, website);
    if (seats.available <= 0) throw teamSeatsExhausted(seats);
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const invitation = await ctx.prisma.websiteInvitation.upsert({
    where: { websiteId_email: { websiteId: siteId, email } },
    create: {
      websiteId: siteId,
      email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedById: userId,
      expiresAt,
    },
    update: { role: input.role, tokenHash: hashToken(token), invitedById: userId, expiresAt },
    select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
  });

  const inviter = await ctx.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  await sendEmail(
    invitationEmail(email, {
      inviterName: inviter?.name ?? "Someone",
      siteName: website.name,
      siteDomain: website.domain,
      role: input.role,
      url: invitationUrl(token),
      days: INVITATION_TTL_DAYS,
    }),
  );

  return invitation;
};

export const revokeInvitation = async (
  ctx: AppContext,
  userId: string,
  siteId: string,
  invitationId: string,
) => {
  await getManagedWebsite(ctx, userId, siteId);
  const result = await ctx.prisma.websiteInvitation.deleteMany({
    where: { id: invitationId, websiteId: siteId },
  });
  if (!result.count) throw notFound("Invitation not found");
};

/**
 * What an invitation link points at, for the accept page. Needs no session:
 * the token is unguessable and the page has to tell a signed-out visitor
 * which account to sign in with.
 */
export const getInvitation = async ({ prisma }: AppContext, token: string) => {
  const invitation = await prisma.websiteInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      website: { select: { name: true, domain: true } },
      invitedBy: { select: { name: true } },
    },
  });
  if (!invitation) throw notFound("This invitation does not exist or was withdrawn");

  return {
    email: invitation.email,
    role: invitation.role,
    site: invitation.website,
    invitedBy: invitation.invitedBy.name,
    expiresAt: invitation.expiresAt,
    expired: invitation.expiresAt.getTime() <= Date.now(),
  };
};

export const acceptInvitation = async (ctx: AppContext, userId: string, token: string) => {
  const invitation = await ctx.prisma.websiteInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { website: { select: { id: true, domain: true, userId: true } } },
  });
  if (!invitation) throw notFound("This invitation does not exist or was withdrawn");
  if (invitation.expiresAt.getTime() <= Date.now()) throw invitationExpired();

  const user = await ctx.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user || user.email.toLowerCase() !== invitation.email) {
    throw invitationEmailMismatch(invitation.email);
  }

  if (invitation.website.userId === userId) {
    await ctx.prisma.websiteInvitation.delete({ where: { id: invitation.id } });
    return { websiteId: invitation.website.id, domain: invitation.website.domain, role: "OWNER" as const };
  }

  await ctx.prisma.$transaction([
    ctx.prisma.websiteMember.upsert({
      where: { websiteId_userId: { websiteId: invitation.websiteId, userId } },
      create: { websiteId: invitation.websiteId, userId, role: invitation.role },
      update: { role: invitation.role },
    }),
    ctx.prisma.websiteInvitation.delete({ where: { id: invitation.id } }),
  ]);

  return { websiteId: invitation.website.id, domain: invitation.website.domain, role: invitation.role };
};

export const updateMemberRole = async (
  ctx: AppContext,
  userId: string,
  siteId: string,
  memberId: string,
  role: WebsiteRole,
) => {
  await getManagedWebsite(ctx, userId, siteId);
  if (!isWebsiteRole(role)) throw badRequest("role must be ADMIN or VIEWER");

  const member = await ctx.prisma.websiteMember.findFirst({ where: { id: memberId, websiteId: siteId } });
  if (!member) throw notFound("Member not found");

  return ctx.prisma.websiteMember.update({ where: { id: member.id }, data: { role } });
};

/**
 * Remove a member. Managers may remove anyone; a member may remove themself
 * (leave), which is why this does not start with getManagedWebsite.
 */
export const removeMember = async (
  ctx: AppContext,
  userId: string,
  siteId: string,
  memberId: string,
) => {
  const member = await ctx.prisma.websiteMember.findFirst({ where: { id: memberId, websiteId: siteId } });
  if (!member) throw notFound("Member not found");

  if (member.userId !== userId) {
    await getManagedWebsite(ctx, userId, siteId);
  }

  await ctx.prisma.websiteMember.delete({ where: { id: member.id } });
};

/** Housekeeping for the purge job: drop invitations nobody can accept any more. */
export const purgeExpiredInvitations = async ({ prisma }: AppContext) => {
  const result = await prisma.websiteInvitation.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
};
