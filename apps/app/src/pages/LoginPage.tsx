import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth, useLogin } from "../features/auth/hooks/useAuth";
import { loginSchema, type LoginFormData } from "../features/auth/schema";
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

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);

  const { mutate, isPending } = useLogin();
  const { isLoggedIn, isLoading } = useAuth();
  const navigate = useNavigate();
  // /auth/error forwards the Google failure message via router state.
  const location = useLocation();
  // A neutral message, e.g. after deleting the account; not an error.
  const notice = (location.state as { notice?: string } | null)?.notice ?? null;
  // Where ProtectedRoute sent us from (an invitation link, a deep link); only
  // in-app paths are honoured so state can never redirect off-site.
  const from = (location.state as { from?: string } | null)?.from;
  const destination = from && from.startsWith("/") && !from.startsWith("//") ? from : "/sites";
  const [formError, setFormError] = useState<string | null>(
    (location.state as { error?: string } | null)?.error ?? null,
  );
  const { registration } = useAuthProviders();
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const resend = useResendVerification();

  const form = useForm<LoginFormData>({
    defaultValues: { email: "", password: "" },
    resolver: zodResolver(loginSchema),
  });
  const { handleSubmit } = form;

  const onSubmit = (data: LoginFormData) => {
    mutate(
      {
        email: data.email,
        password: data.password,
      },
      {
        onSuccess: () => {
          navigate(destination);
        },
        onError: (err) => {
          // Errors reject as the flat { status, code, message } from lib/axios.
          setUnverifiedEmail((err as { code?: string }).code === "EMAIL_NOT_VERIFIED" ? data.email : null);
          setFormError(err.message);
        },
      },
    );
  };

  useEffect(() => {
    if (!isLoading && isLoggedIn) {
      navigate(destination);
    }
  }, [isLoggedIn, isLoading, navigate, destination]);

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your account to continue."
      footer={
        registration ? (
          <>
          Don&apos;t have an account?{" "}
          <Link to="/signup" className="font-medium text-brand-ink hover:underline">
            Sign up
          </Link>
          </>
        ) : undefined
      }
      legal={legalNotice("signing in")}
    >
      <Form {...form}>
        <form onSubmit={handleSubmit(onSubmit)}>
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

          <div className="mt-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-baseline justify-between gap-3">
                    <FormLabel>Password</FormLabel>
                    <Link
                      to="/forgot-password"
                      className="text-[12.5px] font-medium text-brand-ink hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>

                  <div className="relative">
                    <FormControl>
                      <Input
                        {...field}
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter your password"
                        autoComplete="current-password"
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

          {notice && !formError && (
            <p className="mt-4 rounded-md bg-black/[0.04] px-3 py-2 text-[13px] text-text-secondary dark:bg-white/[0.06]">
              {notice}
            </p>
          )}
          {formError && (
            <p className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
              {formError}
              {unverifiedEmail && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => resend.mutate(unverifiedEmail)}
                    disabled={resend.isPending}
                    className="font-medium underline disabled:opacity-60"
                  >
                    {resend.isPending ? "Sending..." : resend.isSuccess ? "Link sent" : "Send a new link"}
                  </button>
                </>
              )}
            </p>
          )}

          <AuthSubmit pending={isPending} pendingLabel="Signing in…">
            Sign in
          </AuthSubmit>
        </form>
      </Form>

      <GoogleButton />
    </AuthShell>
  );
}
