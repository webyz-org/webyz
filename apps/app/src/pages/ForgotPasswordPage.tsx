import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "react-router";

import { Field } from "../shared/components/Field";
import AuthShell, { AuthSubmit } from "../features/auth/components/AuthShell";
import { useForgotPassword } from "../features/auth/hooks/useAuth";
import {
  forgotPasswordSchema,
  type ForgotPasswordFormData,
} from "../features/auth/schema";

export default function ForgotPasswordPage() {
  const { mutate, isPending, isSuccess, data, error } = useForgotPassword();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will email you a link to choose a new one."
      back={{ label: "Back to login", to: "/login" }}
      footer={
        <>
          Remembered it?{" "}
          <Link to="/login" className="font-medium text-brand-ink hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {isSuccess ? (
        <div className="rounded-lg border border-border bg-primary-soft/40 p-4">
          <p className="text-[13.5px] text-text-primary">{data?.message}</p>
          <p className="mt-2 text-[13px] text-text-muted">
            The link expires in 30 minutes. Check your spam folder if it does not arrive.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit((values) => mutate(values))}>
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            {...register("email")}
            error={Boolean(errors.email)}
            helperText={errors.email?.message}
          />

          {error && (
            <p className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
              {(error as { message?: string }).message}
            </p>
          )}

          <AuthSubmit pending={isPending} pendingLabel="Sending…">
            Send reset link
          </AuthSubmit>
        </form>
      )}
    </AuthShell>
  );
}
