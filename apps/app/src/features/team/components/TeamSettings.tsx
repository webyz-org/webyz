import { useState } from "react";
import { Link } from "react-router";
import { Mail, Trash2 } from "lucide-react";

import { Button } from "../../../shared/components/ui/button";
import { Card, CardContent } from "../../../shared/components/ui/card";
import { Field, SelectField } from "../../../shared/components/Field";
import {
  useInviteMember,
  useMembers,
  useRemoveMember,
  useRevokeInvitation,
  useUpdateMemberRole,
} from "../hooks/useTeam";
import type { Member, WebsiteRole } from "../types";
import type { Website } from "../../websites/types";

const ROLE_LABELS: Record<WebsiteRole, string> = {
  ADMIN: "Admin",
  VIEWER: "Viewer",
};

const ROLE_HELP: Record<WebsiteRole, string> = {
  ADMIN: "Manages settings, goals, funnels, sharing and people. Cannot delete the site.",
  VIEWER: "Sees every report, realtime and exports. Changes nothing.",
};

const errorMessage = (error: unknown) =>
  (error as { message?: string } | null)?.message ?? "Something went wrong";

/**
 * Who can open this site. The owner and admins invite by email; an invitation
 * holds a seat until it is accepted or expires. Seats come from the owner's
 * plan, owner included, so the count shown is what the plan pays for.
 */
export default function TeamSettings({ site, currentUserId }: { site: Website; currentUserId?: string }) {
  const members = useMembers(site.id);
  const invite = useInviteMember(site.id);
  const revoke = useRevokeInvitation(site.id);
  const updateRole = useUpdateMemberRole(site.id);
  const remove = useRemoveMember(site.id);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WebsiteRole>("VIEWER");
  const [sent, setSent] = useState<string | null>(null);

  const data = members.data;
  const canManage = data?.role === "owner" || data?.role === "admin";
  const seatsLeft = data ? Math.max(0, data.seats.limit - data.seats.used) : 0;

  const submit = () => {
    const address = email.trim();
    if (!address) return;
    invite.mutate(
      { email: address, role },
      {
        onSuccess: () => {
          setSent(address);
          setEmail("");
        },
      },
    );
  };

  const roleSelect = (member: Member) => (
    <select
      value={member.role}
      aria-label={`Role of ${member.user.email}`}
      disabled={updateRole.isPending}
      onChange={(e) => updateRole.mutate({ memberId: member.id, role: e.target.value as WebsiteRole })}
      className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-primary"
    >
      {(Object.keys(ROLE_LABELS) as WebsiteRole[]).map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4">
          <div>
            <h2 className="font-medium">People</h2>
            <p className="text-sm text-text-muted">
              Who can open {site.domain}, and what they may change.
              {data && (
                <>
                  {" "}
                  {data.seats.used} of {data.seats.limit} seat{data.seats.limit === 1 ? "" : "s"} on the{" "}
                  {data.seats.planName} plan in use, owner included.
                </>
              )}
            </p>
          </div>

          {members.isLoading && (
            <div className="h-20 animate-pulse rounded-lg bg-black/5 dark:bg-white/10" />
          )}
          {members.error && (
            <p className="text-sm text-danger">{errorMessage(members.error)}</p>
          )}

          {data && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {data.owner && (
                <li className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{data.owner.name}</p>
                    <p className="truncate text-xs text-text-muted">{data.owner.email}</p>
                  </div>
                  <span className="shrink-0 text-xs text-text-muted">Owner</span>
                </li>
              )}
              {data.members.map((member) => {
                const isSelf = member.user.id === currentUserId;
                return (
                  <li key={member.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {member.user.name}
                        {isSelf && <span className="ml-1 text-xs text-text-muted">(you)</span>}
                      </p>
                      <p className="truncate text-xs text-text-muted">{member.user.email}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canManage ? (
                        roleSelect(member)
                      ) : (
                        <span className="text-xs text-text-muted">{ROLE_LABELS[member.role]}</span>
                      )}
                      {(canManage || isSelf) && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={isSelf ? "Leave this site" : `Remove ${member.user.email}`}
                          title={isSelf ? "Leave this site" : "Remove"}
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(member.id)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
              {data.invitations.map((invitation) => (
                <li key={invitation.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <Mail size={14} className="shrink-0 text-text-muted" />
                    <div className="min-w-0">
                      <p className="truncate">{invitation.email}</p>
                      <p className="text-xs text-text-muted">
                        Invited as {ROLE_LABELS[invitation.role].toLowerCase()}, expires{" "}
                        {new Date(invitation.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Withdraw invitation to ${invitation.email}`}
                      title="Withdraw invitation"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(invitation.id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {(updateRole.error || remove.error || revoke.error) && (
            <p className="text-sm text-danger">
              {errorMessage(updateRole.error ?? remove.error ?? revoke.error)}
            </p>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardContent className="space-y-4">
            <div>
              <h2 className="font-medium">Invite someone</h2>
              <p className="text-sm text-text-muted">
                They get an email with a link that works for seven days and only for an account signed in
                with that address. Re-sending to the same address refreshes the link.
              </p>
            </div>

            <Field
              label="Email address"
              type="email"
              placeholder="colleague@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />

            <SelectField
              label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value as WebsiteRole)}
              helperText={ROLE_HELP[role]}
            >
              {(Object.keys(ROLE_LABELS) as WebsiteRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </SelectField>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={submit} disabled={!email.trim() || invite.isPending || seatsLeft === 0}>
                {invite.isPending ? "Sending..." : "Send invitation"}
              </Button>
              {seatsLeft === 0 && (
                <span className="text-sm text-text-muted">
                  No seats left on this plan.{" "}
                  {data?.role === "owner" && (
                    <Link to="/settings/billing" className="text-primary hover:underline">
                      Upgrade
                    </Link>
                  )}
                </span>
              )}
              {sent && !invite.error && (
                <span className="text-sm text-success">Invitation sent to {sent}</span>
              )}
              {invite.error && <span className="text-sm text-danger">{errorMessage(invite.error)}</span>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
