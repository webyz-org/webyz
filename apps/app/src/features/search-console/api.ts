import { del, get, getPaged, post } from "../../lib/axios";
import type {
  GscDimension,
  GscProperty,
  GscSearchResponse,
  GscSortKey,
  GscStatus,
} from "./types";

export const getGscStatusApi = (siteId: string) =>
  get<GscStatus>(`/websites/${siteId}/gsc`);

export const getGscAuthUrlApi = (siteId: string) =>
  get<{ url: string }>(`/websites/${siteId}/gsc/auth-url`);

export const listGscPropertiesApi = (siteId: string) =>
  get<GscProperty[]>(`/websites/${siteId}/gsc/properties`);

export const selectGscPropertyApi = (siteId: string, propertyUri: string) =>
  post<GscStatus>(`/websites/${siteId}/gsc/property`, { propertyUri });

export const disconnectGscApi = (siteId: string) =>
  del<{ disconnected: boolean }>(`/websites/${siteId}/gsc`);

export type GscSearchQuery = {
  period: string;
  from?: string;
  to?: string;
  dimension: GscDimension;
  search?: string;
  sort: GscSortKey;
  order: "asc" | "desc";
  page: number;
  limit: number;
};

/** Pagination rides in the envelope meta; fold it back into one object. */
export const getGscSearchApi = async (
  siteId: string,
  query: GscSearchQuery,
): Promise<GscSearchResponse> => {
  const res = await getPaged<Omit<GscSearchResponse, "meta">>(
    `/websites/${siteId}/gsc/search-analytics`,
    {
      period: query.period,
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      dimension: query.dimension,
      ...(query.search ? { search: query.search } : {}),
      sort: query.sort,
      order: query.order,
      page: query.page,
      limit: query.limit,
    },
  );

  return {
    ...res.data,
    meta: res.meta as unknown as GscSearchResponse["meta"],
  };
};
