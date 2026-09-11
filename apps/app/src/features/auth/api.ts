import { api, get, post } from "../../lib/axios";
import type {
  ForgotPasswordFormData,
  LoginFormData,
  SignupFormData,
} from "./schema";
import type { User } from "./types";

/** When `requiresVerification` is true no session was set: the emailed link signs the user in. */
export const signupApi = (data: SignupFormData) =>
  post<{ user: User; requiresVerification: boolean }>("/users/auth/signup", {
    name: data.name,
    email: data.email,
    password: data.password,
  });

export const loginApi = (data: LoginFormData) =>
  post<{ user: User }>("/users/auth/login", data);

export const getMe = () => get<{ user: User }>("/users/auth/me");

export const verifyEmailApi = (token: string) => post<{ user: User }>("/users/auth/verify-email", { token });

export const resendVerificationApi = (email: string) =>
  post<{ message: string }>("/users/auth/verify-email/resend", { email });

export const changePasswordApi = (data: { currentPassword: string; newPassword: string }) =>
  post<{ message: string }>("/users/auth/password", data);

/** Everything the account holds, as a JSON file the browser saves. */
export const downloadAccountExportApi = async (): Promise<void> => {
  const res = await api.get<Blob>("/users/me/export", { responseType: "blob" });
  const disposition = String(res.headers["content-disposition"] ?? "");
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "webyz-account.json";
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

/** Irreversible. Password accounts must send their password; Google-only accounts send nothing. */
export const deleteAccountApi = (password?: string) =>
  api.delete<{ success: true; data: { deleted: true } }>("/users/me", { data: password ? { password } : {} }).then((r) => r.data.data);

/** Which sign-in methods the API has configured; drives the Google button. */
export const getAuthProviders = () =>
  get<{ google: boolean; registration: boolean }>("/users/auth/providers");

export const logoutApi = () =>
  post<{ message: string }>("/users/auth/logout");

export const forgotPasswordApi = (data: ForgotPasswordFormData) =>
  post<{ message: string }>("/users/auth/password/forgot", data);

export const resetPasswordApi = (data: { token: string; newPassword: string }) =>
  post<{ message: string }>("/users/auth/password/reset", data);
