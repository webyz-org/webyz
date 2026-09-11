import { del, get, patch, post, put } from "../../lib/axios";
import type { AddWebsiteInput } from "./schema";
import type { Goal, ShareState, ShareUnlock, SharedWebsite, Website } from "./types";

export const createWebsiteApi = (data: AddWebsiteInput) =>
  post<Website>("/websites", data);

export const getWebsitesApi = () => get<Website[]>("/websites");

export const getWebsiteApi = (siteId: string) =>
  get<Website>(`/websites/${siteId}`);

/** Whether the site has ever received an event; polled by the setup screen. */
export const getInstallStatusApi = (siteId: string) =>
  get<{ hasEvents: boolean }>(`/websites/${siteId}/install-status`);

export const updateWebsiteApi = (
  siteId: string,
  data: Partial<Pick<Website, "name" | "domain" | "timezone">>,
) => patch<Website>(`/websites/${siteId}`, data);

export const deleteWebsiteApi = (siteId: string) =>
  del<{ deleted: boolean }>(`/websites/${siteId}`);

export const enableSharingApi = (siteId: string) =>
  post<ShareState>(`/websites/${siteId}/share`);

export const disableSharingApi = (siteId: string) =>
  del<ShareState>(`/websites/${siteId}/share`);

/** Set or replace the password in front of the share link; sharing must be on. */
export const setSharePasswordApi = (siteId: string, password: string) =>
  put<ShareState>(`/websites/${siteId}/share/password`, { password });

export const clearSharePasswordApi = (siteId: string) =>
  del<ShareState>(`/websites/${siteId}/share/password`);

/** Public: resolves a share slug to the site the dashboard should render. */
export const getSharedWebsiteApi = (slug: string) =>
  get<SharedWebsite>(`/shared/${slug}`);

/** Public: trade the share password for a token; rejects with SHARE_PASSWORD_INVALID. */
export const unlockSharedWebsiteApi = (slug: string, password: string) =>
  post<ShareUnlock>(`/shared/${slug}/unlock`, { password });

// ─── Goals ────────────────────────────────────────────────────────────────────

export const getGoalsApi = (siteId: string) =>
  get<Goal[]>(`/websites/${siteId}/goals`);

export const createGoalApi = (
  siteId: string,
  data: { name: string; eventName?: string; pagePath?: string },
) => post<Goal>(`/websites/${siteId}/goals`, data);

export const deleteGoalApi = (siteId: string, goalId: string) =>
  del<{ deleted: boolean }>(`/websites/${siteId}/goals/${goalId}`);
