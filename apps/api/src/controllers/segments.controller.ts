import { FastifyReply, FastifyRequest } from "fastify";

import { sendResponse } from "../http/helper/send-response.js";
import {
  getAccessibleWebsite,
  getManagedWebsite,
} from "../core/website/website.service.js";
import {
  SegmentInput,
  createSegment,
  deleteSegment,
  listSegments,
  listSharedSegments,
  updateSegment,
} from "../core/website/segments.service.js";

/** Same header the site-access plugin reads for password-protected shares. */
const SHARE_TOKEN_HEADER = "x-share-token";

type SiteParams = { siteId: string };
type SegmentParams = SiteParams & { segmentId: string };

/** Anyone with access to the site (owner or any member) may read segments. */
export const listSegmentsController = async (
  request: FastifyRequest<{ Params: SiteParams }>,
  reply: FastifyReply,
) => {
  await getAccessibleWebsite(request.ctx, request.session.userId, request.params.siteId);
  const segments = await listSegments(request.ctx, request.params.siteId);
  return sendResponse(reply, segments);
};

/** Owner or ADMIN member: segments are site settings, like goals. */
export const createSegmentController = async (
  request: FastifyRequest<{ Params: SiteParams; Body: SegmentInput }>,
  reply: FastifyReply,
) => {
  await getManagedWebsite(request.ctx, request.session.userId, request.params.siteId);
  const segment = await createSegment(request.ctx, request.params.siteId, request.body);
  return sendResponse(reply, segment, { statusCode: 201 });
};

export const updateSegmentController = async (
  request: FastifyRequest<{ Params: SegmentParams; Body: Partial<SegmentInput> }>,
  reply: FastifyReply,
) => {
  await getManagedWebsite(request.ctx, request.session.userId, request.params.siteId);
  const segment = await updateSegment(
    request.ctx,
    request.params.siteId,
    request.params.segmentId,
    request.body,
  );
  return sendResponse(reply, segment);
};

export const deleteSegmentController = async (
  request: FastifyRequest<{ Params: SegmentParams }>,
  reply: FastifyReply,
) => {
  await getManagedWebsite(request.ctx, request.session.userId, request.params.siteId);
  await deleteSegment(request.ctx, request.params.siteId, request.params.segmentId);
  return sendResponse(reply, { deleted: true });
};

/**
 * Public: the segments of a shared dashboard, read-only, resolved by slug.
 * A password-protected share needs the unlock token, as every other read does.
 */
export const listSharedSegmentsController = async (
  request: FastifyRequest<{ Params: { slug: string } }>,
  reply: FastifyReply,
) => {
  const header = request.headers[SHARE_TOKEN_HEADER];
  const token = Array.isArray(header) ? header[0] : header;
  const segments = await listSharedSegments(request.ctx, request.params.slug, token);
  return sendResponse(reply, segments);
};
