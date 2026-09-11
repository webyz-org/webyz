import { del, get, patch, post } from "../../lib/axios";
import type {
  AcceptResult,
  Invitation,
  InvitationDetails,
  MembersResponse,
  WebsiteRole,
} from "./types";

export const getMembersApi = (siteId: string) =>
  get<MembersResponse>(`/websites/${siteId}/members`);

export const inviteMemberApi = (siteId: string, input: { email: string; role: WebsiteRole }) =>
  post<Invitation>(`/websites/${siteId}/members/invitations`, input);

export const revokeInvitationApi = (siteId: string, invitationId: string) =>
  del<{ revoked: boolean }>(`/websites/${siteId}/members/invitations/${invitationId}`);

export const updateMemberRoleApi = (siteId: string, memberId: string, role: WebsiteRole) =>
  patch<{ id: string; role: WebsiteRole }>(`/websites/${siteId}/members/${memberId}`, { role });

export const removeMemberApi = (siteId: string, memberId: string) =>
  del<{ removed: boolean }>(`/websites/${siteId}/members/${memberId}`);

export const getInvitationApi = (token: string) =>
  get<InvitationDetails>(`/invitations/${token}`);

export const acceptInvitationApi = (token: string) =>
  post<AcceptResult>(`/invitations/${token}/accept`, {});
