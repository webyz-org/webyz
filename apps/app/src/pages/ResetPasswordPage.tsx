import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Eye, EyeOff } from "lucide-react";

import { Field } from "../shared/components/Field";
import AuthShell, { AuthSubmit } from "../features/auth/components/AuthShell";
import { useResetPassword } from "../features/auth/hooks/useAuth";
import {
  resetPasswordSchema,
  type ResetPasswordFormData,
} from "../features/auth/schema";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();

  const [show, setShow] = useState(false);
  const { mutate, isPending, error } = useResetPassword();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  if (!token) {
    return (
      <AuthShell
        title="This link is incomplete"
        subtitle="Open the link from your email, or request a new one."
        back={{ label: "Back to login", to: "/login" }}
      >
        <Link
          to="/forgot-password"
          className="flex h-10 w-full items-center justify-center rounded-lg border border-border bg-surface text-sm font-medium text-text-primary transition-colors duration-150 hover:border-border-strong hover:bg-bg/70"
        >
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="You will be signed out everywhere else."
      back={{ label: "Back to login", to: "/login" }}
      footer={
        <Link to="/forgot-password" className="font-medium text-brand-ink hover:underline">
          Need a new link?
        </Link>
      }
    >
      <form
        onSubmit={handleSubmit((values) =>
          mutate(
            { token, newPassword: values.newPassword },
            // Straight to login: the reset revoked every session, so there is
            // nothing to be logged into yet.
            { onSuccess: () => navigate("/login", { replace: true }) },
          ),
        )}
      >
        <div className="relative">
          <Field
            label="New password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            {...register("newPassword")}
            error={Boolean(errors.newPassword)}
            helperText={errors.newPassword?.message ?? "At least 8 characters"}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-2 top-8 text-text-muted transition-colors duration-150 hover:text-text-primary"
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        <div className="mt-4">
          <Field
            label="Confirm new password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            {...register("confirmPassword")}
            error={Boolean(errors.confirmPassword)}
            helperText={errors.confirmPassword?.message}
          />
        </div>

        {error && (
          <p className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {(error as { message?: string }).message}
          </p>
        )}

        <AuthSubmit pending={isPending} pendingLabel="Updating…">
          Update password
        </AuthSubmit>
      </form>
    </AuthShell>
  );
}
