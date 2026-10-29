import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { deleteSiteExportApi, getSiteExportApi, requestSiteExportApi } from "../api";

const exportKey = (siteId: string) => ["site-export", siteId];

/** The site's prepared export; polls while it is being built. */
export const useSiteExport = (siteId: string) =>
  useQuery({
    queryKey: exportKey(siteId),
    queryFn: () => getSiteExportApi(siteId),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
    // Keep checking in a background tab: people switch away while it builds.
    refetchIntervalInBackground: true,
  });

export const useRequestExport = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => requestSiteExportApi(siteId),
    // Seed the running state, then refetch: polling is scheduled by a fetch,
    // and setting the cache alone does not start it.
    onSuccess: (created) => {
      qc.setQueryData(exportKey(siteId), created);
      void qc.invalidateQueries({ queryKey: exportKey(siteId) });
    },
  });
};

export const useDeleteExport = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (exportId: string) => deleteSiteExportApi(siteId, exportId),
    onSuccess: () => qc.setQueryData(exportKey(siteId), null),
  });
};
