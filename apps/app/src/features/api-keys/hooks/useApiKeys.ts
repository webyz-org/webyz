import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createApiKeyApi, getApiKeysApi, revokeApiKeyApi } from "../api";

export const apiKeysKey = ["api-keys"];

export const useApiKeys = () => useQuery({ queryKey: apiKeysKey, queryFn: getApiKeysApi });

export const useCreateApiKey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createApiKeyApi,
    onSuccess: () => void qc.invalidateQueries({ queryKey: apiKeysKey }),
  });
};

export const useRevokeApiKey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: revokeApiKeyApi,
    onSuccess: () => void qc.invalidateQueries({ queryKey: apiKeysKey }),
  });
};
