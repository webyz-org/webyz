import { FastifyReply, FastifyRequest } from "fastify";

import { sendResponse } from "../http/helper/send-response.js";
import { normalizePagination } from "../http/normalize/pagination.js";
import { resolveRetainedWindow, retentionMeta, type RetainedWindow } from "../core/billing/entitlements/retention.js";
import { getBreakdown } from "../core/analytics/breakdown.service.js";
import { getTopStats } from "../core/analytics/top-stats.service.js";
import { getMainGraph } from "../core/analytics/main-graph.service.js";
import { getRealtime } from "../core/analytics/realtime.service.js";
import {
  getConversions,
  getCustomEventProperties,
  getCustomEvents,
} from "../core/analytics/goals.service.js";
import { getJourneys } from "../core/analytics/journeys.service.js";
import { getPageDetail, getPages } from "../core/analytics/pages.service.js";
import { EXPORT_DATASETS, getExportTable, isExportDataset } from "../core/analytics/export.service.js";
import { safeFilenamePart, toCsv } from "../http/helper/csv.js";
import type { PagesSortKey } from "../db/clickhouse/pages.js";
import {
  DEFAULT_REALTIME_PAGE_WINDOW,
  REALTIME_PAGE_WINDOWS,
  getRealtimeVisitors,
  getVisitorActivity,
} from "../core/analytics/realtime.service.js";
import { realtimeChannel } from "../core/realtime/publisher.js";
import { subscribeRealtime } from "../core/realtime/hub.js";
import { badRequest } from "../errors/http-errors.js";
import { siteAccessDenied } from "../errors/domain-errors.js";
import { CORS_ORIGINS } from "../config/env.js";
import { countDrops } from "../core/bots/drops.js";
import type { SessionDimension } from "../db/clickhouse/breakdown.js";
import {
  FILTER_KEYS,
  parseFilterValue,
  type AnalyticsFilters,
} from "../db/clickhouse/filters.js";
import type { AppContext } from "../lib/context.js";
import type { Interval } from "../db/clickhouse/timeseries.js";

type AnalyticsQuery = {
  period: string;
  date?: string;
  from?: string;
  to?: string;
  limit?: string;
  page?: string;
  detailed?: string;
  metric?: string;
  interval?: Interval;
};

/**
 * Drill-down filters ride as `f.<key>` query params (e.g. `f.browser=Chrome`),
 * prefixed so they can never collide with pagination's `page` or the period's
 * `from`/`to`. Unknown keys are ignored; values are matched via the allowlist
 * in db/clickhouse/filters.ts, and an operator prefix on the value (`!`, `~`,
 * `!~`) selects is-not, contains or does-not-contain.
 *
 * `f.goal=<goal name>` is sugar the dashboard uses when a goal row is clicked:
 * it is resolved here against the site's goals into the `event` or `page`
 * filter the goal is defined by, so the query layer never sees goal names.
 * A name that matches no goal filters to nothing, like an unknown event would.
 */
const collectFilters = async (
  ctx: AppContext,
  websiteId: string,
  query: unknown,
): Promise<AnalyticsFilters> => {
  const params = query as Record<string, unknown>;
  const filters: AnalyticsFilters = {};
  for (const key of FILTER_KEYS) {
    const raw = params[`f.${key}`];
    if (typeof raw !== "string" || raw === "") continue;
    const condition = parseFilterValue(raw.slice(0, 1000));
    if (condition) filters[key] = condition;
  }

  const goalRaw = params["f.goal"];
  if (typeof goalRaw === "string" && goalRaw !== "") {
    const condition = parseFilterValue(goalRaw.slice(0, 1000));
    if (condition) {
      const goal = await ctx.prisma.goal.findUnique({
        where: { websiteId_name: { websiteId, name: condition.value } },
        select: { eventName: true, pagePath: true },
      });
      if (goal?.eventName) {
        filters.event = { op: condition.op, value: goal.eventName };
      } else if (goal?.pagePath) {
        filters.page = { op: condition.op, value: goal.pagePath };
      } else if (condition.op === "is" || condition.op === "contains") {
        // No such goal: match nothing rather than silently everything.
        filters.event = { op: "is", value: `\u0000no-such-goal:${condition.value}` };
      }
      // "goal is not <unknown>" excludes nothing, so no filter is the right answer.
    }
  }

  return filters;
};

/** The filters of the current request, resolved for its site. */
const requestFilters = (request: FastifyRequest) =>
  collectFilters(request.ctx, request.website.id, request.query);

/**
 * Resolve the requested window in the site's own timezone, cut to what the
 * site owner's plan retains (core/billing/entitlements/retention.ts). Every
 * analytics read goes through here, so no endpoint can be talked into
 * returning history the plan does not include, whatever `from` says.
 */
const resolveWindow = (request: FastifyRequest): Promise<RetainedWindow> => {
  const query = request.query as AnalyticsQuery;
  return resolveRetainedWindow(request.ctx, {
    ownerId: request.website.userId,
    timezone: request.website.timezone,
    query: { period: query.period, date: query.date, from: query.from, to: query.to },
  });
};

/**
 * One handler for every dimension breakdown. Each route binds a dimension, so
 * adding a breakdown is a single line in the route table rather than another
 * near-identical controller.
 */
export const breakdownController =
  (dimension: SessionDimension | "page") =>
  async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as AnalyticsQuery;
    const { limit, page } = normalizePagination(query);
    const range = await resolveWindow(request);

    const data = await getBreakdown(request.ctx, {
      websiteId: request.website.id,
      dimension,
      from: range.from,
      to: range.to,
      limit,
      page,
      detailed: query.detailed === "true",
      filters: await requestFilters(request),
    });

    return sendResponse(reply, data.results, { meta: { ...data.meta, ...retentionMeta(range) } });
  };

export const getTopStatsController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const range = await resolveWindow(request);

  // Compare against the immediately preceding window of the same length,
  // never reaching before the retention floor (nor the epoch): a comparison
  // must not surface history the plan does not include. When the preceding
  // window would lie entirely before the floor it collapses to empty.
  const span = range.to - range.from;
  const compareFrom = Math.max(range.from - span, range.retention.floor, 0);
  const compareTo = Math.max(range.from, compareFrom);

  const stats = await getTopStats(request.ctx, {
    websiteId: request.website.id,
    from: range.from,
    to: range.to,
    compareFrom,
    compareTo,
    filters: await requestFilters(request),
  });

  return sendResponse(reply, {
    from: range.from,
    to: range.to,
    comparing_from: compareFrom,
    comparing_to: compareTo,
    top_stats: stats,
  }, { meta: retentionMeta(range) });
};

export const getMainGraphController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const query = request.query as AnalyticsQuery;
  const range = await resolveWindow(request);

  const data = await getMainGraph(request.ctx, {
    websiteId: request.website.id,
    from: range.from,
    to: range.to,
    metric: query.metric || "visitors",
    interval: query.interval || "hour",
    timezone: request.website.timezone,
    filters: await requestFilters(request),
  });

  return sendResponse(reply, data, { meta: retentionMeta(range) });
};

export const getRealtimeController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const data = await getRealtime(request.ctx, request.website.id);
  return sendResponse(reply, data);
};

export const getConversionsController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const range = await resolveWindow(request);

  const data = await getConversions(request.ctx, {
    websiteId: request.website.id,
    from: range.from,
    to: range.to,
    filters: await requestFilters(request),
  });

  return sendResponse(reply, data.results, { meta: { ...data.meta, ...retentionMeta(range) } });
};

// ─── Export ──────────────────────────────────────────────────────────────────

/** YYYY-MM-DD of an instant in the site's timezone, for the filename. */
const localDate = (epochSeconds: number, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(epochSeconds * 1000),
  );

/**
 * One CSV per dataset, same period, filters and retention cut as the
 * dashboard. Owner or member only: an export is the whole table, not a
 * glance at a public dashboard.
 */
export const exportController = async (request: FastifyRequest, reply: FastifyReply) => {
  requireSiteOwner(request);

  const query = request.query as AnalyticsQuery & { dataset?: string };
  const dataset = query.dataset ?? "";
  if (!isExportDataset(dataset)) {
    throw badRequest(`dataset must be one of ${EXPORT_DATASETS.join(", ")}`, { dataset });
  }

  const range = await resolveWindow(request);
  const table = await getExportTable(request.ctx, {
    websiteId: request.website.id,
    dataset,
    from: range.from,
    to: range.to,
    timezone: request.website.timezone,
    filters: await requestFilters(request),
  });

  const site = request.website;
  // `to` is exclusive (start of the next day), so the last included day is to - 1.
  const filename = `${safeFilenamePart(site.domain)}-${dataset}-${localDate(range.from, site.timezone)}-${localDate(range.to - 1, site.timezone)}.csv`;

  return reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="${filename}"`)
    .header("Cache-Control", "no-store")
    .send(toCsv(table.columns, table.rows));
};

// ─── Realtime page ───────────────────────────────────────────────────────────
//
// Visitor-level realtime data is for the site's people only. authorizeSite
// lets anyone view a PUBLIC site's aggregates, which is right for share links,
// but per-visitor rows, the live stream and exports are more sensitive than
// any aggregate, so these endpoints additionally require an owner or member.

const requireSiteOwner = (request: FastifyRequest) => {
  if (request.siteRole === "public") {
    throw siteAccessDenied();
  }
};

const resolveRealtimeWindow = (query: { window?: string }): number => {
  if (!query.window) return DEFAULT_REALTIME_PAGE_WINDOW;
  const window = Number(query.window);
  if (!(REALTIME_PAGE_WINDOWS as readonly number[]).includes(window)) {
    throw badRequest(
      `window must be one of ${REALTIME_PAGE_WINDOWS.join(", ")}`,
    );
  }
  return window;
};

export const getRealtimeVisitorsController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  requireSiteOwner(request);
  const window = resolveRealtimeWindow(request.query as { window?: string });

  const data = await getRealtimeVisitors(
    request.ctx,
    request.website.id,
    window,
  );

  return sendResponse(reply, data);
};

export const getVisitorActivityController = async (
  request: FastifyRequest<{ Params: { siteId: string; visitorId: string } }>,
  reply: FastifyReply,
) => {
  requireSiteOwner(request);
  const window = resolveRealtimeWindow(request.query as { window?: string });

  const data = await getVisitorActivity(
    request.ctx,
    request.website.id,
    request.params.visitorId,
    window,
  );

  return sendResponse(reply, data);
};

const SSE_HEARTBEAT_MS = 25_000;

/**
 * Server-Sent Events stream of this site's live activity. The response is
 * hijacked from Fastify's normal pipeline, so CORS headers are set by hand
 * against the same allowlist the cors plugin uses. Nothing is fetched here:
 * events arrive from ingest via Redis pub/sub (see core/realtime) and are
 * forwarded verbatim; the client renders its snapshot first and treats this
 * stream as increments.
 */
export const realtimeStreamController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  requireSiteOwner(request);
  const websiteId = request.website.id;

  reply.hijack();
  const raw = reply.raw;

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
  const origin = request.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  raw.writeHead(200, headers);
  raw.write("retry: 3000\n\n");

  const unsubscribe = subscribeRealtime(
    realtimeChannel(websiteId),
    (message) => {
      raw.write(`data: ${message}\n\n`);
    },
  );

  // Comment frames keep proxies from closing an otherwise quiet stream.
  const heartbeat = setInterval(() => {
    raw.write(":hb\n\n");
  }, SSE_HEARTBEAT_MS);

  request.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
};

const JOURNEY_MAX_DEPTH = 5;

export const getJourneysController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const query = request.query as AnalyticsQuery & {
    metric?: string;
    startingPath?: string;
    depth?: string;
  };
  const range = await resolveWindow(request);

  const metric = query.metric === "sessions" ? "sessions" : "users";

  const depth = query.depth ? Number(query.depth) : JOURNEY_MAX_DEPTH;
  if (!Number.isInteger(depth) || depth < 1 || depth > JOURNEY_MAX_DEPTH) {
    throw badRequest(`depth must be an integer between 1 and ${JOURNEY_MAX_DEPTH}`);
  }

  const startingPath = query.startingPath?.slice(0, 1000) || undefined;

  const data = await getJourneys(request.ctx, {
    websiteId: request.website.id,
    from: range.from,
    to: range.to,
    metric,
    startingPath,
    depth,
  });

  return sendResponse(reply, data, { meta: retentionMeta(range) });
};

// ─── Pages ───────────────────────────────────────────────────────────────────

const PAGES_SORTS: readonly PagesSortKey[] = [
  "views",
  "sessions",
  "visitors",
  "bounce_rate",
  "duration",
  "trend",
];

export const getPagesController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const query = request.query as AnalyticsQuery & {
    search?: string;
    sort?: string;
    order?: string;
  };
  const { limit, page } = normalizePagination(query);
  const range = await resolveWindow(request);

  const sort = (PAGES_SORTS as readonly string[]).includes(query.sort ?? "")
    ? (query.sort as PagesSortKey)
    : "views";
  const order = query.order === "asc" ? "asc" : "desc";

  const data = await getPages(request.ctx, {
    websiteId: request.website.id,
    timezone: request.website.timezone,
    from: range.from,
    to: range.to,
    search: query.search?.slice(0, 200),
    sort,
    order,
    limit,
    page,
  });

  const { meta, ...rest } = data;
  return sendResponse(reply, rest, { meta: { ...meta, ...retentionMeta(range) } });
};

export const getPageDetailController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const query = request.query as AnalyticsQuery & { path?: string };
  const range = await resolveWindow(request);

  const path = query.path?.slice(0, 1000);
  if (!path) throw badRequest("path is required");

  const data = await getPageDetail(request.ctx, {
    websiteId: request.website.id,
    timezone: request.website.timezone,
    path,
    from: range.from,
    to: range.to,
  });

  return sendResponse(reply, data, { meta: retentionMeta(range) });
};

/**
 * Property keys of one custom event (no `key`), or the values of one key.
 * Both honour the period and every filter, so "which plans did Chrome users
 * sign up for" is a filter plus this call.
 */
export const getCustomEventPropertiesController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const query = request.query as AnalyticsQuery & { event?: string; key?: string };
  const { limit } = normalizePagination(query);
  const range = await resolveWindow(request);

  const eventName = query.event?.slice(0, 100);
  if (!eventName) throw badRequest("event is required");

  const data = await getCustomEventProperties(request.ctx, {
    websiteId: request.website.id,
    from: range.from,
    to: range.to,
    eventName,
    key: query.key?.slice(0, 100) || undefined,
    limit,
    filters: await requestFilters(request),
  });

  return sendResponse(reply, data.results, { meta: { ...data.meta, ...retentionMeta(range) } });
};

export const getCustomEventsController = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const query = request.query as AnalyticsQuery;
  const { limit } = normalizePagination(query);
  const range = await resolveWindow(request);

  const data = await getCustomEvents(request.ctx, {
    websiteId: request.website.id,
    from: range.from,
    to: range.to,
    limit,
    filters: await requestFilters(request),
  });

  return sendResponse(reply, data.results, { meta: retentionMeta(range) });
};

/**
 * What the ingest filters refused for this site in the period, by reason.
 * Members only: a shared dashboard shows the audience, not the plumbing.
 */
export const getFilteredTrafficController = async (request: FastifyRequest, reply: FastifyReply) => {
  requireSiteOwner(request);
  const range = await resolveWindow(request);
  const counts = await countDrops(request.ctx.clickhouse, request.website.id, range.from, range.to);
  return sendResponse(reply, { from: range.from, to: range.to, ...counts });
};
