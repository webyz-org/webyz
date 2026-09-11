import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import AuthShell from "../features/auth/components/AuthShell";
import { useVerifyEmail } from "../features/auth/hooks/useAuth";

/**
 * Where the confirmation email's link lands. Redeems the token once, and on
 * success the API has already set the session cookie, so the user goes
 * straight to their sites. A bad or used link explains itself and points at
 * the sign-in page, where a new link can be requested.
 */
export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const { mutate, isPending, error } = useVerifyEmail();
  const [done, setDone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    mutate(token, { onSuccess: () => setDone(true) });
  }, [token, mutate]);

  useEffect(() => {
    if (done) navigate("/sites", { replace: true });
  }, [done, navigate]);

  if (!token) {
    return (
      <AuthShell
        title="This link is incomplete"
        subtitle="Open the link from your email, or sign in to request a new one."
        back={{ label: "Back to login", to: "/login" }}
      >
        <Link to="/login" className="flex h-10 w-full items-center justify-center rounded-lg border border-border bg-surface text-sm font-medium text-text-primary">
          Go to sign in
        </Link>
      </AuthShell>
    );
  }

  if (error) {
    return (
      <AuthShell
        title="That link did not work"
        subtitle={(error as { message?: string }).message ?? "The link is invalid or has expired."}
        back={{ label: "Back to login", to: "/login" }}
      >
        <Link to="/login" className="flex h-10 w-full items-center justify-center rounded-lg border border-border bg-surface text-sm font-medium text-text-primary">
          Request a new link from sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Confirming your email" subtitle={isPending || !done ? "One moment." : "Done. Taking you in."}>
      <div className="h-10 animate-pulse rounded-lg bg-black/[0.05] dark:bg-white/[0.08]" />
    </AuthShell>
  );
}
