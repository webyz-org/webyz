import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  acceptInvitationApi,
  getInvitationApi,
  getMembersApi,
  inviteMemberApi,
  removeMemberApi,
  revokeInvitationApi,
  updateMemberRoleApi,
} from "../api";
import type { WebsiteRole } from "../types";

const membersKey = (siteId: string) => ["members", siteId];

export const useMembers = (siteId?: string) =>
  useQuery({
    queryKey: membersKey(siteId ?? ""),
    queryFn: () => getMembersApi(siteId!),
    enabled: Boolean(siteId),
  });

const useMembersMutation = <TVars>(
  siteId: string,
  fn: (vars: TVars) => Promise<unknown>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: membersKey(siteId) }),
  });
};

export const useInviteMember = (siteId: string) =>
  useMembersMutation(siteId, (input: { email: string; role: WebsiteRole }) =>
    inviteMemberApi(siteId, input),
  );

export const useRevokeInvitation = (siteId: string) =>
  useMembersMutation(siteId, (invitationId: string) => revokeInvitationApi(siteId, invitationId));

export const useUpdateMemberRole = (siteId: string) =>
  useMembersMutation(siteId, (input: { memberId: string; role: WebsiteRole }) =>
    updateMemberRoleApi(siteId, input.memberId, input.role),
  );

export const useRemoveMember = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => removeMemberApi(siteId, memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersKey(siteId) });
      // Leaving a site removes it from the caller's own list.
      qc.invalidateQueries({ queryKey: ["websites"] });
    },
  });
};

export const useInvitation = (token?: string) =>
  useQuery({
    queryKey: ["invitation", token],
    queryFn: () => getInvitationApi(token!),
    enabled: Boolean(token),
    retry: false,
  });

export const useAcceptInvitation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => acceptInvitationApi(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["websites"] }),
  });
};
