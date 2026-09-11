import axios, { AxiosError } from "axios";

import { API_BASE_URL } from "../config/env";
import { SHARE_LOCKED_EVENT, getCurrentShareToken } from "../features/websites/shareToken";

export const API_PREFIX = "/api/v1";

/** Fired on any 401 outside the auth endpoints; SessionWatcher sends the user to login. */
export const UNAUTHORIZED_EVENT = "webyz:unauthorized";

export type ApiError = {
  status?: number;
  code: string;
  message: string;
};

export const api = axios.create({
  baseURL: API_BASE_URL + API_PREFIX,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

/** The public dashboard's proof of password; the plugin reads this header. */
const SHARE_TOKEN_HEADER = "X-Share-Token";

/** Answer codes for a password-protected share: not a lost session. */
const SHARE_CODES = new Set(["SHARE_PASSWORD_REQUIRED", "SHARE_PASSWORD_INVALID"]);

/**
 * Auth is a httpOnly session cookie set by the API, so there is no token to
 * attach for the account itself. The one header added here is the share
 * token, and only while the shared dashboard page has set one.
 */
api.interceptors.request.use((config) => {
  const token = getCurrentShareToken();
  if (token) config.headers.set(SHARE_TOKEN_HEADER, token);
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: { code?: string; message?: string } }>) => {
    const body = error.response?.data;

    const normalized: ApiError = {
      status: error.response?.status,
      code: body?.error?.code ?? "REQUEST_FAILED",
      message:
        body?.error?.message ?? error.message ?? "Something went wrong",
    };

    // A 401 from a data endpoint means the session is gone. Auth endpoints
    // answer 401 as part of their normal job (wrong password, logged-out
    // "me" check), so they are excluded. So is a password-protected shared
    // dashboard: its 401 means "ask for the password", and the shared page
    // listens for that instead.
    const url = error.config?.url ?? "";
    if (normalized.status === 401 && SHARE_CODES.has(normalized.code)) {
      if (normalized.code === "SHARE_PASSWORD_REQUIRED") {
        window.dispatchEvent(new Event(SHARE_LOCKED_EVENT));
      }
    } else if (normalized.status === 401 && !url.startsWith("/users/auth/")) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }

    return Promise.reject(normalized);
  },
);

/** The API wraps every success as { success, data, meta }. */
type Envelope<T> = { success: true; data: T; meta?: Record<string, unknown> };

export async function get<T>(
  url: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const res = await api.get<Envelope<T>>(url, { params });
  return res.data.data;
}

export type Paged<T> = {
  data: T;
  meta: {
    page: number;
    limit: number;
    total_visitors: number;
    total_items: number;
    has_more: boolean;
  };
};

export async function getPaged<T>(
  url: string,
  params?: Record<string, unknown>,
): Promise<Paged<T>> {
  const res = await api.get<Envelope<T>>(url, { params });
  return {
    data: res.data.data,
    meta: (res.data.meta ?? {}) as Paged<T>["meta"],
  };
}

export async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.post<Envelope<T>>(url, body);
  return res.data.data;
}

export async function put<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.put<Envelope<T>>(url, body);
  return res.data.data;
}

export async function patch<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.patch<Envelope<T>>(url, body);
  return res.data.data;
}

export async function del<T>(url: string): Promise<T> {
  const res = await api.delete<Envelope<T>>(url);
  return res.data.data;
}

export default api;
