import { Link, useNavigate, useParams } from "react-router";

import AuthShell from "../features/auth/components/AuthShell";
import { useAuth, useLogout } from "../features/auth/hooks/useAuth";
import { useAcceptInvitation, useInvitation } from "../features/team/hooks/useTeam";
import { Button } from "../shared/components/ui/button";

const ROLE_TEXT = {
  ADMIN: "manage its settings, goals and sharing as an admin",
  VIEWER: "view its dashboard",
} as const;

/**
 * Where an invitation email's link lands. Works signed out: it shows which
 * site and which address the invitation is for, then sends the visitor to
 * sign in (and back here). Signed in with the right address, one click
 * accepts; with another address it explains instead of failing.
 */
export default function InvitationPage() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, isLoggedIn, isLoading: authLoading } = useAuth();
  const invitation = useInvitation(token || undefined);
  const accept = useAcceptInvitation();
  const logout = useLogout();

  if (invitation.isLoading || authLoading) {
    return (
      <AuthShell title="Loading invitation…">
        <div className="h-24 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />
      </AuthShell>
    );
  }

  const details = invitation.data;
  if (!details || invitation.error) {
    return (
      <AuthShell
        title="This invitation is not available"
        subtitle="It may have been withdrawn or already accepted. Ask the person who invited you for a new link."
        back={{ label: "Go to Webyz", to: "/sites" }}
      >
        <Link
          to="/sites"
          className="flex h-10 w-full items-center justify-center rounded-lg border border-border bg-surface text-sm font-medium text-text-primary"
        >
          Go to your sites
        </Link>
      </AuthShell>
    );
  }

  if (details.expired) {
    return (
      <AuthShell
        title="This invitation has expired"
        subtitle={`${details.invitedBy} can send a new one from the People section of ${details.site.domain}.`}
        back={{ label: "Go to Webyz", to: "/sites" }}
      >
        <Link
          to="/sites"
          className="flex h-10 w-full items-center justify-center rounded-lg border border-border bg-surface text-sm font-medium text-text-primary"
        >
          Go to your sites
        </Link>
      </AuthShell>
    );
  }

  const here = `/invitations/${token}`;
  const subtitle = (
    <>
      <strong>{details.invitedBy}</strong> invited <strong>{details.email}</strong> to{" "}
      {ROLE_TEXT[details.role]} of <strong>{details.site.name}</strong> ({details.site.domain}).
    </>
  );

  if (!isLoggedIn) {
    return (
      <AuthShell title="You are invited" subtitle={subtitle} back={{ label: "Sign in", to: "/login" }}>
        <p className="text-sm text-text-muted">
          Sign in with {details.email} to accept. No account yet? Sign up with that address first.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button size="lg" onClick={() => navigate("/login", { state: { from: here } })}>
            Sign in to accept
          </Button>
          <Link
            to="/signup"
            state={{ from: here }}
            className="flex h-10 w-full items-center justify-center rounded-lg border border-border bg-surface text-sm font-medium text-text-primary"
          >
            Create an account
          </Link>
        </div>
      </AuthShell>
    );
  }

  const sameAddress = user?.email.toLowerCase() === details.email.toLowerCase();

  return (
    <AuthShell title="You are invited" subtitle={subtitle} back={{ label: "Your sites", to: "/sites" }}>
      {sameAddress ? (
        <>
          <Button
            size="lg"
            className="w-full"
            disabled={accept.isPending}
            onClick={() =>
              accept.mutate(token, {
                onSuccess: (result) => navigate(`/sites/${result.domain}`, { replace: true }),
              })
            }
          >
            {accept.isPending ? "Joining…" : `Join ${details.site.name}`}
          </Button>
          {accept.error && (
            <p className="mt-3 text-sm text-danger">{(accept.error as { message?: string }).message}</p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-text-muted">
            You are signed in as <strong>{user?.email}</strong>, but this invitation is for{" "}
            <strong>{details.email}</strong>. Sign out and sign in with that address to accept it.
          </p>
          <Button
            size="lg"
            variant="outline"
            className="mt-5 w-full"
            disabled={logout.isPending}
            onClick={() =>
              logout.mutate(undefined, {
                onSuccess: () => navigate("/login", { state: { from: here } }),
              })
            }
          >
            Sign out
          </Button>
        </>
      )}
    </AuthShell>
  );
}
