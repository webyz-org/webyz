import { del, get, patch, post } from "../../lib/axios";
import type { Segment, SegmentInput } from "./types";

export const listSegmentsApi = (siteId: string) =>
  get<Segment[]>(`/websites/${siteId}/segments`);

/** Public share pages: read-only, resolved by the share slug, no auth. */
export const listSharedSegmentsApi = (slug: string) =>
  get<Segment[]>(`/shared/${slug}/segments`);

export const createSegmentApi = (siteId: string, input: SegmentInput) =>
  post<Segment>(`/websites/${siteId}/segments`, input);

export const updateSegmentApi = (
  siteId: string,
  segmentId: string,
  input: Partial<SegmentInput>,
) => patch<Segment>(`/websites/${siteId}/segments/${segmentId}`, input);

export const deleteSegmentApi = (siteId: string, segmentId: string) =>
  del<{ deleted: boolean }>(`/websites/${siteId}/segments/${segmentId}`);
