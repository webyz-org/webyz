import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ApiError } from "../../../lib/axios";
import {
  disconnectGscApi,
  getGscAuthUrlApi,
  getGscSearchApi,
  getGscStatusApi,
  listGscPropertiesApi,
  selectGscPropertyApi,
  type GscSearchQuery,
} from "../api";

const statusKey = (siteId?: string) => ["gsc-status", siteId];

/** Connection states the UI branches on rather than treating as failures. */
const EXPECTED_CODES = new Set([
  "GSC_NOT_CONFIGURED",
  "GSC_NOT_CONNECTED",
  "GSC_NO_PROPERTY",
  "GSC_REAUTH_REQUIRED",
]);

export const isGscStateError = (error: unknown): error is ApiError =>
  Boolean(error) && EXPECTED_CODES.has((error as ApiError).code);

export const useGscStatus = (siteId?: string) =>
  useQuery({
    queryKey: statusKey(siteId),
    queryFn: () => getGscStatusApi(siteId!),
    enabled: Boolean(siteId),
  });

export const useGscProperties = (siteId?: string, enabled = true) =>
  useQuery({
    queryKey: ["gsc-properties", siteId],
    queryFn: () => listGscPropertiesApi(siteId!),
    enabled: enabled && Boolean(siteId),
    retry: false,
  });

/** Fetches the consent URL and sends the browser to Google. */
export const useConnectGsc = (siteId: string) =>
  useMutation({
    mutationFn: async () => {
      const { url } = await getGscAuthUrlApi(siteId);
      window.location.href = url;
    },
  });

export const useSelectGscProperty = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (propertyUri: string) =>
      selectGscPropertyApi(siteId, propertyUri),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: statusKey(siteId) });
      qc.invalidateQueries({ queryKey: ["gsc-search", siteId] });
    },
  });
};

export const useDisconnectGsc = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectGscApi(siteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: statusKey(siteId) });
      qc.invalidateQueries({ queryKey: ["gsc-search", siteId] });
    },
  });
};

export const useGscSearch = (siteId: string | undefined, query: GscSearchQuery) =>
  useQuery({
    queryKey: [
      "gsc-search",
      siteId,
      query.period,
      query.from ?? null,
      query.to ?? null,
      query.dimension,
      query.search ?? "",
      query.sort,
      query.order,
      query.page,
      query.limit,
    ],
    queryFn: () => getGscSearchApi(siteId!, query),
    enabled: Boolean(siteId),
    // Connection-state 409s are terminal until the user acts; retrying them
    // just delays the reconnect prompt.
    retry: (failureCount, error) =>
      !isGscStateError(error) && failureCount < 2,
    placeholderData: (previous) => previous,
    staleTime: 60_000,
  });
