import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deleteImportApi,
  discardImportConnectionApi,
  getImportAuthUrlApi,
  getImportConnectionApi,
  listImportsApi,
  startImportApi,
} from "../api";

const importsKey = (siteId: string) => ["imports", siteId];
const connectionKey = (siteId: string) => ["imports-connection", siteId];

/** Polls every few seconds while an import is queued or running. */
export const useImports = (siteId: string) =>
  useQuery({
    queryKey: importsKey(siteId),
    queryFn: () => listImportsApi(siteId),
    refetchInterval: (query) =>
      query.state.data?.some((i) => i.status === "pending" || i.status === "running") ? 3000 : false,
    // A GA4 import runs for minutes; keep its progress current in a background tab.
    refetchIntervalInBackground: true,
  });

export const useImportConnection = (siteId: string, enabled: boolean) =>
  useQuery({
    queryKey: connectionKey(siteId),
    queryFn: () => getImportConnectionApi(siteId),
    enabled,
    retry: false,
  });

/** Fetches the consent URL and sends the browser to Google. */
export const useConnectGa4 = (siteId: string) =>
  useMutation({
    mutationFn: async () => {
      const { url } = await getImportAuthUrlApi(siteId);
      window.location.href = url;
    },
  });

export const useDiscardConnection = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => discardImportConnectionApi(siteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionKey(siteId) }),
  });
};

/** A finished or removed import changes every number on the dashboard. */
const invalidateAnalytics = (qc: ReturnType<typeof useQueryClient>, siteId: string) => {
  qc.invalidateQueries({ queryKey: importsKey(siteId) });
  qc.invalidateQueries({ queryKey: connectionKey(siteId) });
  qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(siteId) });
};

export const useStartImport = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { propertyId: string; startDate?: string; endDate?: string }) =>
      startImportApi(siteId, body),
    onSuccess: () => invalidateAnalytics(qc, siteId),
  });
};

export const useDeleteImport = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (importId: string) => deleteImportApi(siteId, importId),
    onSuccess: () => invalidateAnalytics(qc, siteId),
  });
};
