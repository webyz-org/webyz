import { useEffect } from "react";
import { Navigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import { meKey } from "../features/auth/hooks/useAuth";

/**
 * Where the API sends the browser after Google OAuth. On success the session
 * cookie is already set, so we only need to drop the cached "me" answer (which
 * may be a 401 from before the redirect) and let ProtectedRoute refetch it.
 */
export function AuthSuccessPage() {
  const qc = useQueryClient();

  useEffect(() => {
    qc.removeQueries({ queryKey: meKey });
  }, [qc]);

  return <Navigate to="/sites" replace />;
}

const REASONS: Record<string, string> = {
  access_denied: "Google sign-in was cancelled.",
  invalid_state: "That sign-in link expired. Please try again.",
  missing_params: "Google did not return a sign-in code. Please try again.",
  exchange_failed: "Google sign-in could not be completed. Please try again.",
  not_configured: "Google sign-in is not available on this server. Use your email and password.",
  registration_disabled: "Registration is closed on this server. Ask the administrator for an account.",
};

export function AuthErrorPage() {
  const [params] = useSearchParams();
  const reason = params.get("reason") ?? "";
  const message = REASONS[reason] ?? "Google sign-in failed. Please try again.";

  return <Navigate to="/login" replace state={{ error: message }} />;
}
