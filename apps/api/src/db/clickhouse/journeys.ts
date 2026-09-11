import { ClickHouseClient } from "@clickhouse/client";

/**
 * Journey (user path) queries.
 *
 * Definitions, which the dashboard relies on - change them deliberately:
 *
 * - A journey is one session's pageview paths in time order, with consecutive
 *   duplicates collapsed. A refresh, an SPA re-render or back/forward onto the
 *   same page is NOT a step; only a move to a different path is.
 * - Starting point: a path chosen by the caller. Each session's journey is
 *   rooted at the FIRST occurrence of that path in its collapsed path list.
 *   Sessions that never visit the path are excluded.
 * - Step depth k: the k-th distinct path after the root within that session.
 * - Volume: unique users (default) or unique sessions reaching (depth, path).
 *   Journeys are always walked per session; the users metric only changes the
 *   deduplication, so one user with two sessions contributes two journeys but
 *   counts once per (depth, path).
 * - Percentage (computed in the service): volume / root volume * 100, from raw
 *   volumes, never from rounded intermediates.
 *
 * All three queries share the same per-session CTE so the semantics cannot
 * drift apart. Sessions are capped at 500 pageviews as a safety valve against
 * pathological clients; beyond that a "journey" is meaningless anyway.
 */

export type JourneyMetric = "users" | "sessions";

export type JourneyStepRow = {
  depth: number;
  path: string;
  volume: number;
};

export type JourneyStartRow = {
  path: string;
  volume: number;
};

export type JourneyEventRow = {
  path: string;
  name: string;
  volume: number;
};

type BaseInput = {
  websiteId: string;
  from: number;
  to: number;
  metric: JourneyMetric;
};

/** The deduplication column is an allowlist, never caller input. */
const metricColumn = (metric: JourneyMetric) =>
  metric === "sessions" ? "session_id" : "user_id";

/**
 * One row per session: its collapsed path list. `raw` is sorted by timestamp
 * before collapsing so out-of-order inserts cannot fabricate steps.
 */
const perSessionCte = `
  per_session AS (
    SELECT
      session_id,
      any(user_id) AS user_id,
      arrayMap(t -> tupleElement(t, 2),
        arraySort(t -> tupleElement(t, 1), groupArray(500)((timestamp, url_path)))
      ) AS raw
    FROM events
    WHERE website_id = {websiteId:String}
      AND event_type = 'pageview'
      AND timestamp >= fromUnixTimestamp({from:UInt32})
      AND timestamp <  fromUnixTimestamp({to:UInt32})
    GROUP BY session_id
  ),
  journeys AS (
    SELECT
      session_id,
      user_id,
      arrayFilter((p, i) -> i = 1 OR p != raw[i - 1], raw, arrayEnumerate(raw)) AS paths
    FROM per_session
  )
`;

/**
 * Candidate starting points: every path, with the volume of journeys that
 * would be rooted there (= sessions containing the path at least once).
 */
export const journeyStartingPointsQuery = async (
  clickhouse: ClickHouseClient,
  input: BaseInput & { limit: number },
): Promise<JourneyStartRow[]> => {
  const result = await clickhouse.query({
    query: `
      WITH ${perSessionCte}
      SELECT
        path,
        toUInt32(uniqExact(${metricColumn(input.metric)})) AS volume
      FROM journeys
      ARRAY JOIN arrayDistinct(paths) AS path
      GROUP BY path
      ORDER BY volume DESC, path ASC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      websiteId: input.websiteId,
      from: input.from,
      to: input.to,
      limit: input.limit,
    },
    format: "JSONEachRow",
  });

  return result.json<JourneyStartRow>();
};

/**
 * The journey itself: volumes per (depth, path) for journeys rooted at
 * `startingPath`, up to `depth` steps after the root. Depth 0 is the root and
 * doubles as the starting-point volume. Branches per depth are capped by
 * `branchLimit`, ordered by volume.
 */
export const journeyStepsQuery = async (
  clickhouse: ClickHouseClient,
  input: BaseInput & {
    startingPath: string;
    depth: number;
    branchLimit: number;
  },
): Promise<JourneyStepRow[]> => {
  const result = await clickhouse.query({
    query: `
      WITH ${perSessionCte},
      rooted AS (
        SELECT
          session_id,
          user_id,
          arraySlice(
            paths,
            indexOf(paths, {startingPath:String}),
            {sliceLen:UInt16}
          ) AS journey
        FROM journeys
        WHERE has(paths, {startingPath:String})
      )
      SELECT
        toUInt16(idx - 1) AS depth,
        journey[idx] AS path,
        toUInt32(uniqExact(${metricColumn(input.metric)})) AS volume
      FROM rooted
      ARRAY JOIN arrayEnumerate(journey) AS idx
      GROUP BY depth, path
      ORDER BY depth ASC, volume DESC, path ASC
      LIMIT {branchLimit:UInt32} BY depth
    `,
    query_params: {
      websiteId: input.websiteId,
      from: input.from,
      to: input.to,
      startingPath: input.startingPath,
      sliceLen: input.depth + 1,
      branchLimit: input.branchLimit,
    },
    format: "JSONEachRow",
  });

  return result.json<JourneyStepRow>();
};

/**
 * Custom events fired by the rooted journeys' sessions, grouped by the page
 * they happened on. The service pairs them with journey columns; they explain
 * a transition, they are never steps themselves.
 */
export const journeyEventsQuery = async (
  clickhouse: ClickHouseClient,
  input: BaseInput & { startingPath: string },
): Promise<JourneyEventRow[]> => {
  const result = await clickhouse.query({
    query: `
      WITH ${perSessionCte}
      SELECT
        url_path AS path,
        event_name AS name,
        toUInt32(uniqExact(${metricColumn(input.metric)})) AS volume
      FROM events
      WHERE website_id = {websiteId:String}
        AND event_type = 'event'
        AND event_name != ''
        AND timestamp >= fromUnixTimestamp({from:UInt32})
        AND timestamp <  fromUnixTimestamp({to:UInt32})
        AND session_id IN (
          SELECT session_id FROM journeys WHERE has(paths, {startingPath:String})
        )
      GROUP BY path, name
      ORDER BY volume DESC, name ASC
      LIMIT 5 BY path
    `,
    query_params: {
      websiteId: input.websiteId,
      from: input.from,
      to: input.to,
      startingPath: input.startingPath,
    },
    format: "JSONEachRow",
  });

  return result.json<JourneyEventRow>();
};
