import { useState } from "react";
import { useNavigate } from "react-router";
import { Download, TriangleAlert } from "lucide-react";

import { Button } from "../shared/components/ui/button";
import { Card, CardContent } from "../shared/components/ui/card";
import { Field } from "../shared/components/Field";
import { useAuth, useChangePassword, useDeleteAccount } from "../features/auth/hooks/useAuth";
import { downloadAccountExportApi } from "../features/auth/api";

const errorMessage = (err: unknown) => (err as { message?: string })?.message ?? "Something went wrong";

/**
 * Account settings: who you are, your password, your data, and the way out.
 * The two GDPR actions live here on purpose: export before delete, on the same
 * screen, so nobody has to hunt for either.
 */
export default function AccountPage() {
  const { user } = useAuth();
  const hasPassword = user?.provider !== "google";

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold">Account</h1>
        <p className="text-sm text-text-muted">Your sign-in details, a copy of your data, and account deletion.</p>
      </div>

      <Card>
        <CardContent className="space-y-1">
          <h2 className="font-medium">Profile</h2>
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
            <dt className="text-text-muted">Name</dt>
            <dd>{user?.name}</dd>
            <dt className="text-text-muted">Email</dt>
            <dd>{user?.email}</dd>
            <dt className="text-text-muted">Sign-in</dt>
            <dd>
              {user?.provider === "google"
                ? "Google"
                : user?.provider === "email_google"
                  ? "Password or Google"
                  : "Email and password"}
            </dd>
          </dl>
        </CardContent>
      </Card>

      {hasPassword && <ChangePasswordCard />}

      <Card>
        <CardContent className="space-y-3">
          <div>
            <h2 className="font-medium">Download your data</h2>
            <p className="text-sm text-text-muted">
              One JSON file with your profile, websites, goals, funnels, subscriptions, sessions, API key names and
              invoices. Analytics are downloaded per website as CSV from each dashboard&apos;s export menu.
            </p>
          </div>
          <ExportButton />
        </CardContent>
      </Card>

      <DeleteAccountCard hasPassword={hasPassword} email={user?.email ?? ""} />
    </div>
  );
}

function ChangePasswordCard() {
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 8;
  const ready = current && next.length >= 8 && next === confirm;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setDone(false);
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          setDone(true);
          setCurrent("");
          setNext("");
          setConfirm("");
        },
      },
    );
  };

  return (
    <Card>
      <CardContent>
        <h2 className="font-medium">Change password</h2>
        <p className="text-sm text-text-muted">Every other signed-in device is logged out when you change it.</p>
        <form onSubmit={submit} className="mt-4 grid gap-3 sm:max-w-md">
          <Field
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            error={tooShort}
            helperText={tooShort ? "At least 8 characters" : undefined}
          />
          <Field
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={mismatch}
            helperText={mismatch ? "Passwords do not match" : undefined}
          />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!ready || change.isPending}>
              {change.isPending ? "Saving..." : "Update password"}
            </Button>
            {done && <span className="text-sm text-success">Password updated.</span>}
            {change.error && <span className="text-sm text-danger">{errorMessage(change.error)}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ExportButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadAccountExportApi();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" onClick={() => void run()} disabled={busy}>
        <Download size={15} />
        {busy ? "Preparing..." : "Download JSON"}
      </Button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}

function DeleteAccountCard({ hasPassword, email }: { hasPassword: boolean; email: string }) {
  const navigate = useNavigate();
  const remove = useDeleteAccount();
  const [typedEmail, setTypedEmail] = useState("");
  const [password, setPassword] = useState("");

  const ready = typedEmail.trim().toLowerCase() === email.toLowerCase() && (!hasPassword || password.length > 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    remove.mutate(hasPassword ? password : undefined, {
      onSuccess: () =>
        navigate("/login", {
          replace: true,
          state: { notice: "Your account and all of its data have been deleted." },
        }),
    });
  };

  return (
    <Card className="border-danger/40">
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-danger" />
          <div>
            <h2 className="font-medium text-danger">Delete account</h2>
            <p className="text-sm text-text-muted">
              Cancels any subscription immediately, then deletes your account, every website and all of their
              analytics data. There is no undo and no refund for the rest of a paid period. Download your data first
              if you want to keep it.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="grid gap-3 sm:max-w-md">
          <Field
            label={`Type your email (${email}) to confirm`}
            autoComplete="off"
            value={typedEmail}
            onChange={(e) => setTypedEmail(e.target.value)}
          />
          {hasPassword && (
            <Field
              label="Your password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" variant="destructive" disabled={!ready || remove.isPending}>
              {remove.isPending ? "Deleting..." : "Delete my account"}
            </Button>
            {remove.error && <span className="text-sm text-danger">{errorMessage(remove.error)}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
