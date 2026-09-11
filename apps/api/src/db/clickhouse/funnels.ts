import { ClickHouseClient } from "@clickhouse/client";

/**
 * Funnel analysis with ClickHouse's windowFunnel, computed per session:
 * a session advances to step k when it hits the first k step conditions in
 * order (other activity in between is fine, same as Plausible). Counting is
 * over the events table directly - sessions is a ReplacingMergeTree and plays
 * no part here, so there is nothing to deduplicate.
 *
 * The step conditions are assembled from an allowlisted shape (event name XOR
 * page path) with every value bound as a query parameter; the only inlined
 * text is TS-generated indexes.
 */

export type FunnelStepCondition = {
  eventName?: string | null;
  pagePath?: string | null;
};

/** Longer than any real session, so within-session ordering is what decides. */
const FUNNEL_WINDOW_SECONDS = 86_400;

export type FunnelLevelCounts = {
  /** Unique users reaching at least step k (index 0 = step 1). */
  visitors: number[];
  /** Sessions reaching at least step k. */
  sessions: number[];
};

export const funnelAnalysisQuery = async (
  clickhouse: ClickHouseClient,
  input: {
    websiteId: string;
    from: number;
    to: number;
    steps: FunnelStepCondition[];
  },
): Promise<FunnelLevelCounts> => {
  const query_params: Record<string, unknown> = {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    window: FUNNEL_WINDOW_SECONDS,
  };

  const conditions = input.steps.map((step, i) => {
    const param = `step${i}`;
    if (step.eventName) {
      query_params[param] = step.eventName;
      return `(event_type = 'event' AND event_name = {${param}:String})`;
    }
    query_params[param] = step.pagePath ?? "";
    return `(event_type = 'pageview' AND url_path = {${param}:String})`;
  });

  const levelSelects = input.steps
    .map(
      (_, i) => `
      toUInt32(uniqExactIf(user_id, level >= ${i + 1})) AS visitors_${i + 1},
      toUInt32(countIf(level >= ${i + 1})) AS sessions_${i + 1}`,
    )
    .join(",");

  const result = await clickhouse.query({
    query: `
      WITH per_session AS (
        SELECT
          session_id,
          any(user_id) AS user_id,
          windowFunnel({window:UInt32})(timestamp, ${conditions.join(", ")}) AS level
        FROM events
        WHERE website_id = {websiteId:String}
          AND timestamp >= fromUnixTimestamp({from:UInt32})
          AND timestamp <  fromUnixTimestamp({to:UInt32})
          AND (${conditions.join(" OR ")})
        GROUP BY session_id
      )
      SELECT ${levelSelects}
      FROM per_session
    `,
    query_params,
    format: "JSONEachRow",
  });

  const rows = await result.json<Record<string, number>>();
  const row = rows[0] ?? {};

  return {
    visitors: input.steps.map((_, i) => Number(row[`visitors_${i + 1}`] ?? 0)),
    sessions: input.steps.map((_, i) => Number(row[`sessions_${i + 1}`] ?? 0)),
  };
};
