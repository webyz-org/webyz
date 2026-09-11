import { Prisma } from "../../generated/prisma/client.js";
import { AppContext } from "../../lib/context.js";
import { FILTER_KEYS, isFilterKey, parseFilterValue } from "../../db/clickhouse/filters.js";
import { badRequest, conflict, notFound } from "../../errors/http-errors.js";
import { sharePasswordRequired } from "../../errors/domain-errors.js";
import { verifyShareToken } from "./share-token.js";

/**
 * Saved segments: a named set of dashboard filters per site, so "organic
 * mobile visitors from Germany" is one click instead of three. A segment
 * stores filters in their wire form, `{ browser: "Chrome", page: "!~/admin" }`,
 * exactly what the dashboard puts in the URL and the API reads, so applying
 * one is a plain `replaceFilters` and nothing is re-encoded on either side.
 */

export const MAX_SEGMENTS_PER_SITE = 50;
export const MAX_SEGMENT_FILTERS = 10;
export const MAX_SEGMENT_NAME_LENGTH = 80;
export const MAX_SEGMENT_FILTER_VALUE_LENGTH = 1000;

/** Wire form: filter key -> value with an optional operator prefix. */
export type SegmentFilters = Record<string, string>;

export type SegmentInput = { name: string; filters: SegmentFilters };

/**
 * `goal` is a dashboard-level key: the analytics controller resolves it into
 * a `page` or `event` filter by looking the goal up, so it is not in the
 * ClickHouse allowlist but is a legitimate thing to save.
 *
 * The route schema must name every key here explicitly: the app-wide Ajv runs
 * with `removeAdditional: "all"`, which silently strips any body key a schema
 * does not list under `properties`, so a bare `additionalProperties` schema
 * would hand the service an empty object.
 */
export const SEGMENT_FILTER_KEYS: readonly string[] = [...FILTER_KEYS, "goal"];

const isSegmentFilterKey = (key: string) => key === "goal" || isFilterKey(key);

export const normalizeSegmentName = (raw: unknown): string => {
  if (typeof raw !== "string") throw badRequest("Segment name must be a string");
  const name = raw.trim();
  if (!name) throw badRequest("Segment name is required");
  if (name.length > MAX_SEGMENT_NAME_LENGTH) {
    throw badRequest(`Segment name must be at most ${MAX_SEGMENT_NAME_LENGTH} characters`);
  }
  return name;
};

/**
 * Validate the filters of a segment and return them as a plain object. Every
 * key must be a filter the dashboard understands and every value must parse
 * as a filter condition (a bare operator prefix with nothing after it is not
 * one). Rejecting here means a stored segment can always be applied.
 */
export const validateSegmentFilters = (raw: unknown): SegmentFilters => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw badRequest("Segment filters must be an object of filter key to value");
  }

  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) {
    throw badRequest("A segment needs at least one filter (unknown filter keys are ignored)");
  }
  if (entries.length > MAX_SEGMENT_FILTERS) {
    throw badRequest(`A segment can hold at most ${MAX_SEGMENT_FILTERS} filters`);
  }

  const filters: SegmentFilters = {};
  for (const [key, value] of entries) {
    if (!isSegmentFilterKey(key)) {
      throw badRequest(`Unknown filter key: ${key}`, { key });
    }
    if (typeof value !== "string" || value === "") {
      throw badRequest(`Filter ${key} must be a non-empty string`, { key });
    }
    if (value.length > MAX_SEGMENT_FILTER_VALUE_LENGTH) {
      throw badRequest(
        `Filter ${key} must be at most ${MAX_SEGMENT_FILTER_VALUE_LENGTH} characters`,
        { key },
      );
    }
    if (!parseFilterValue(value)) {
      throw badRequest(`Filter ${key} has an operator but no value`, { key });
    }
    filters[key] = value;
  }

  return filters;
};

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

const duplicateName = (name: string) =>
  conflict(`A segment named "${name}" already exists on this site`);

export const listSegments = async ({ prisma }: AppContext, websiteId: string) =>
  prisma.segment.findMany({
    where: { websiteId },
    orderBy: { name: "asc" },
  });

/**
 * Segments of a shared dashboard, resolved by slug with no session. A share
 * with a password protects its segments the way it protects analytics: the
 * caller must present the token `POST /shared/:slug/unlock` issued, verified
 * exactly as the site-access plugin does. Segment names and filter values
 * describe the site's traffic, so they are not public when the numbers are not.
 */
export const listSharedSegments = async (
  ctx: AppContext,
  slug: string,
  shareToken: string | undefined,
) => {
  const website = await ctx.prisma.website.findFirst({
    where: { publicSlug: slug, isPublic: true },
    select: { id: true, sharePasswordHash: true },
  });
  if (!website) throw notFound("Shared dashboard not found");

  if (
    website.sharePasswordHash &&
    !verifyShareToken(website.id, website.sharePasswordHash, shareToken)
  ) {
    throw sharePasswordRequired();
  }

  return listSegments(ctx, website.id);
};

export const createSegment = async (
  { prisma }: AppContext,
  websiteId: string,
  input: SegmentInput,
) => {
  const name = normalizeSegmentName(input.name);
  const filters = validateSegmentFilters(input.filters);

  const count = await prisma.segment.count({ where: { websiteId } });
  if (count >= MAX_SEGMENTS_PER_SITE) {
    throw badRequest(`A site can hold at most ${MAX_SEGMENTS_PER_SITE} segments`);
  }

  try {
    return await prisma.segment.create({ data: { websiteId, name, filters } });
  } catch (err) {
    // The unique index is the authority; a concurrent create with the same
    // name loses here rather than by a pre-check that can race.
    if (isUniqueViolation(err)) throw duplicateName(name);
    throw err;
  }
};

export const updateSegment = async (
  { prisma }: AppContext,
  websiteId: string,
  segmentId: string,
  input: Partial<SegmentInput>,
) => {
  const existing = await prisma.segment.findFirst({ where: { id: segmentId, websiteId } });
  if (!existing) throw notFound("Segment not found");

  const data: { name?: string; filters?: SegmentFilters } = {};
  if (input.name !== undefined) data.name = normalizeSegmentName(input.name);
  if (input.filters !== undefined) data.filters = validateSegmentFilters(input.filters);
  if (!Object.keys(data).length) throw badRequest("Nothing to update");

  try {
    return await prisma.segment.update({ where: { id: segmentId }, data });
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicateName(data.name ?? existing.name);
    throw err;
  }
};

export const deleteSegment = async (
  { prisma }: AppContext,
  websiteId: string,
  segmentId: string,
) => {
  const existing = await prisma.segment.findFirst({ where: { id: segmentId, websiteId } });
  if (!existing) throw notFound("Segment not found");

  await prisma.segment.delete({ where: { id: segmentId } });
};
