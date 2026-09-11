import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router";

import { useAuth, useSignup } from "../features/auth/hooks/useAuth";
import { signupSchema, type SignupFormData } from "../features/auth/schema";
import { Input } from "../shared/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../shared/components/ui/form";
import { Eye, EyeOff } from "lucide-react";

import AuthShell, {
  AuthSubmit,
  GoogleButton,
} from "../features/auth/components/AuthShell";
import { legalNotice } from "../features/auth/components/legalNotice";
import { useAuthProviders, useResendVerification } from "../features/auth/hooks/useAuth";

export default function SignupPage() {
  const [showPassword, setShowPassword] = useState(false);

  const { mutate, isPending } = useSignup();
  const { isLoggedIn, isLoading } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const { registration, isKnown } = useAuthProviders();
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const resend = useResendVerification();

  const form = useForm<SignupFormData>({
    defaultValues: { name: "", email: "", password: "" },
    resolver: zodResolver(signupSchema),
  });

  const { handleSubmit } = form;

  const onSubmit = (data: SignupFormData) => {
    mutate(
      { name: data.name, email: data.email, password: data.password },
      {
        onSuccess: (result) => {
          if (result.requiresVerification) setPendingEmail(data.email);
          else navigate("/sites");
        },
        onError: (err) => setFormError(err.message),
      },
    );
  };

  useEffect(() => {
    if (!isLoading && isLoggedIn) {
      navigate("/sites");
    }
  }, [isLoggedIn, isLoading, navigate]);

  if (pendingEmail) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`We sent a confirmation link to ${pendingEmail}. Open it to finish creating your account and start your trial.`}
        footer={
          <Link to="/login" className="font-medium text-brand-ink hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="space-y-3 rounded-lg border border-border bg-primary-soft/40 p-4 text-[13.5px] text-text-secondary">
          <p>The link is valid for 24 hours. Check your spam folder if it has not arrived in a minute.</p>
          <button
            type="button"
            onClick={() => resend.mutate(pendingEmail)}
            disabled={resend.isPending}
            className="font-medium text-brand-ink hover:underline disabled:opacity-60"
          >
            {resend.isPending ? "Sending..." : resend.isSuccess ? "Sent again" : "Send the link again"}
          </button>
        </div>
      </AuthShell>
    );
  }

  if (isKnown && !registration) {
    return (
      <AuthShell
        title="Registration is closed"
        subtitle="This Webyz server does not accept new accounts. Ask the administrator for one."
        footer={
          <Link to="/login" className="font-medium text-brand-ink hover:underline">
            Back to sign in
          </Link>
        }
      >
        <></>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your free account"
      subtitle="Start collecting data in under five minutes."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-brand-ink hover:underline">
            Sign in
          </Link>
        </>
      }
      legal={legalNotice("creating an account")}
    >
      <Form {...form}>
        <form onSubmit={handleSubmit(onSubmit)}>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Enter your full name" autoComplete="name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="mt-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="you@example.com" autoComplete="email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="mt-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <div className="relative">
                    <FormControl>
                      <Input
                        {...field}
                        type={showPassword ? "text" : "password"}
                        placeholder="Create a password"
                        autoComplete="new-password"
                        className="pr-10"
                      />
                    </FormControl>
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted transition-colors duration-150 hover:text-text-primary"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {formError && (
            <p className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">{formError}</p>
          )}

          <AuthSubmit pending={isPending} pendingLabel="Creating account…">
            Create account
          </AuthSubmit>
        </form>
      </Form>

      <GoogleButton label="Sign up with Google" />
    </AuthShell>
  );
}
