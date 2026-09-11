import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  changePasswordApi,
  deleteAccountApi,
  forgotPasswordApi,
  getAuthProviders,
  getMe,
  resendVerificationApi,
  verifyEmailApi,
  loginApi,
  logoutApi,
  resetPasswordApi,
  signupApi,
} from "../api";

export const meKey = ["me"];

export const useSignup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: signupApi,
    // A signup that needs email confirmation has no session yet; only seed the
    // cache when the API actually signed the user in.
    onSuccess: (data) => {
      if (!data.requiresVerification) qc.setQueryData(meKey, { user: data.user });
    },
  });
};

export const useLogin = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: loginApi,
    onSuccess: (data) => qc.setQueryData(meKey, data),
  });
};

export const useLogout = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: logoutApi,
    onSuccess: () => qc.clear(),
  });
};

export const useAuth = () => {
  const { data, isLoading, isError } = useQuery({
    queryKey: meKey,
    queryFn: getMe,
    retry: false,
    // A 401 is a normal answer here, not a transient failure worth retrying.
    staleTime: 5 * 60 * 1000,
  });

  return {
    user: data?.user,
    isLoading,
    isLoggedIn: Boolean(data?.user),
    isError,
  };
};

type AuthProviders = { google: boolean; registration: boolean };

const PROVIDERS_STORAGE_KEY = "webyz-auth-providers";

/**
 * Last answer the API gave, kept in localStorage so a returning visitor sees
 * the Google button on the first paint instead of after a round trip. Anything
 * malformed reads as absent; the fetch below corrects a stale value.
 */
const readStoredProviders = (): AuthProviders | undefined => {
  try {
    const raw = localStorage.getItem(PROVIDERS_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as AuthProviders).google !== "boolean" ||
      typeof (parsed as AuthProviders).registration !== "boolean"
    ) {
      return undefined;
    }
    const { google, registration } = parsed as AuthProviders;
    return { google, registration };
  } catch {
    return undefined;
  }
};

const fetchAuthProviders = async (): Promise<AuthProviders> => {
  const { google, registration } = await getAuthProviders();
  try {
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify({ google, registration }));
  } catch {
    // Storage blocked or full: the button simply arrives after the fetch.
  }
  return { google, registration };
};

/**
 * Server-side auth configuration. It cannot change without an API restart, so
 * one fetch per page load is plenty, and the previous visit's answer is a safe
 * first render while it is in flight. On error every provider reads as off,
 * which hides the Google button rather than offering a link that cannot work.
 */
export const useAuthProviders = () => {
  const { data, isPlaceholderData } = useQuery({
    queryKey: ["auth-providers"],
    queryFn: fetchAuthProviders,
    placeholderData: readStoredProviders,
    staleTime: Infinity,
    retry: false,
  });
  return {
    google: data?.google ?? false,
    // Assume open until known: hiding the signup link on a transient error
    // would lock a new operator out of a fresh install.
    registration: data?.registration ?? true,
    // Only the API's answer counts; the stored copy is a guess about the past.
    isKnown: data !== undefined && !isPlaceholderData,
  };
};

export const useVerifyEmail = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: verifyEmailApi,
    onSuccess: (data) => qc.setQueryData(meKey, data),
  });
};

export const useResendVerification = () => useMutation({ mutationFn: resendVerificationApi });

export const useChangePassword = () => useMutation({ mutationFn: changePasswordApi });

/** On success the whole cache is dropped: nothing in it belongs to anyone any more. */
export const useDeleteAccount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteAccountApi,
    onSuccess: () => qc.clear(),
  });
};

export const useForgotPassword = () =>
  useMutation({ mutationFn: forgotPasswordApi });

export const useResetPassword = () =>
  useMutation({ mutationFn: resetPasswordApi });
