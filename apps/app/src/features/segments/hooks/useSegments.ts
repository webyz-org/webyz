import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createSegmentApi,
  deleteSegmentApi,
  listSegmentsApi,
  listSharedSegmentsApi,
  updateSegmentApi,
} from "../api";
import type { SegmentInput } from "../types";

const segmentsKey = (siteId?: string) => ["segments", siteId];

export const useSegments = (siteId?: string) =>
  useQuery({
    queryKey: segmentsKey(siteId),
    queryFn: () => listSegmentsApi(siteId!),
    enabled: Boolean(siteId),
  });

/** The public dashboard's read-only list, keyed by share slug. */
export const useSharedSegments = (slug?: string) =>
  useQuery({
    queryKey: ["shared-segments", slug],
    queryFn: () => listSharedSegmentsApi(slug!),
    enabled: Boolean(slug),
    retry: false,
  });

export const useCreateSegment = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SegmentInput) => createSegmentApi(siteId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: segmentsKey(siteId) }),
  });
};

export const useUpdateSegment = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ segmentId, input }: { segmentId: string; input: Partial<SegmentInput> }) =>
      updateSegmentApi(siteId, segmentId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: segmentsKey(siteId) }),
  });
};

export const useDeleteSegment = (siteId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (segmentId: string) => deleteSegmentApi(siteId, segmentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: segmentsKey(siteId) }),
  });
};
