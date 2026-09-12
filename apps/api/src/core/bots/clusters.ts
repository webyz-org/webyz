import { ClickHouseClient } from "@clickhouse/client";
import type { Redis } from "ioredis";

/**
 * Behavioural filter: scripted traffic that passes the other two.
 *
 * A browser farm on residential proxies sends a real user agent from a real
 * ISP address, so nothing about one request gives it away. What gives it
 * away is the population: hundreds of "visitors" an hour that share one
 * viewport, one browser family and one language, every one of them a single
 * pageview, and not one of them ever reporting engagement, because a script
 * never hides its tab. People are not like that: fifty real visitors on one
 * screen size will leave, switch tabs and scroll, and the engagement events
 * follow.
 *
 * Every five minutes the job below groups the last hour's sessions per site
 * by (screen, browser family, language) and flags any group that is large,
 * spread over many visitors, all bounces and entirely without engagement.
 * A flag is a Redis key for 24 hours; ingest drops requests that match a
 * flagged group of their site. Nothing already written is removed: the
 * filter is forward-looking, like the others.
 *
 * Two guards keep it honest. A site is only examined once enough of its
 * sessions in the window carry engagement (an absolute count, not a share:
 * on the first site this ran against, scripted sessions were 45% of the
 * hour and a share test could never have passed, since the bots are in the
 * denominator). The count proves the deployed tracker sends engagement; a
 * site on an older cached script has none anywhere and would otherwise look
 * entirely scripted. And the cluster thresholds are absolute too, so a small
 * site's whole audience can never form a "cluster".
 */
export const CLUSTER_WINDOW_MINUTES = 60;
export const CLUSTER_FLAG_TTL_SECONDS = 24 * 3600;
export const CLUSTER_MIN_VISITS = 50;
export const CLUSTER_MIN_VISITORS = 20;
export const CLUSTER_MIN_BOUNCE_SHARE = 0.95;
export const SITE_MIN_ENGAGED_SESSIONS = 30;

/**
 * Whether a request can be judged against a flag at all.
 *
 * The flag is keyed on (screen, browser family, language), and only a
 * pageview carries those: the tracker's engagement reports and custom events
 * send neither screen nor language, so judging them would compare the empty
 * key `"|Chrome|"` against the flags. A group with no screen and no language
 * is not a signature either, it is "every visitor of this browser whose
 * script did not report dimensions" (the pixel fallback), so such a group is
 * never flagged and never matched. Dropping the visit's pageview is enough:
 * without a session a later engagement writes nothing, which is how
 * Plausible discards an engagement with no session.
 */
export const clusterFilterApplies = (
  eventType: string,
  screen: string,
  language: string,
): boolean => eventType === "pageview" && screen !== "" && language !== "";

export type ClusterRow = {
  website_id: string;
  screen: string;
  browser_family: string;
  language: string;
  visits: number;
  visitors: number;
  bounces: number;
  engaged: number;
};

/** The group a request belongs to, as stored in the flag key. */
export const clusterKey = (screen: string, browserFamily: string, language: string) =>
  `${screen}|${browserFamily}|${language}`;

export const flagKey = (websiteId: string, key: string) => `bots:cluster:${websiteId}:${key}`;

/** Pure decision, for tests: does this group look scripted? */
export const isScriptedCluster = (row: ClusterRow): boolean =>
  clusterFilterApplies("pageview", row.screen, row.language) &&
  row.visits >= CLUSTER_MIN_VISITS &&
  row.visitors >= CLUSTER_MIN_VISITORS &&
  row.engaged === 0 &&
  row.bounces >= row.visits * CLUSTER_MIN_BOUNCE_SHARE;

/**
 * Groups of the last hour that meet the size floors, on sites whose traffic
 * proves the tracker reports engagement. The size floors are in SQL so the
 * result is small; the decision is repeated in `isScriptedCluster` so the
 * two cannot drift.
 */
export const findClusterCandidates = async (clickhouse: ClickHouseClient): Promise<ClusterRow[]> => {
  const result = await clickhouse.query({
    query: `
      WITH engaged_sites AS (
        SELECT website_id
        FROM sessions FINAL
        WHERE start_time >= now() - INTERVAL {window:UInt32} MINUTE
        GROUP BY website_id
        HAVING countIf(engaged_seconds > 0) >= {minEngaged:UInt32}
      )
      SELECT
        website_id,
        screen,
        browser_family,
        language,
        toUInt32(count()) AS visits,
        toUInt32(uniq(user_id)) AS visitors,
        toUInt32(countIf(page_views = 1)) AS bounces,
        toUInt32(countIf(engaged_seconds > 0)) AS engaged
      FROM sessions FINAL
      WHERE start_time >= now() - INTERVAL {window:UInt32} MINUTE
        AND website_id IN engaged_sites
      GROUP BY website_id, screen, browser_family, language
      HAVING visits >= {minVisits:UInt32} AND visitors >= {minVisitors:UInt32}
        AND screen != '' AND language != ''
    `,
    query_params: {
      window: CLUSTER_WINDOW_MINUTES,
      minEngaged: SITE_MIN_ENGAGED_SESSIONS,
      minVisits: CLUSTER_MIN_VISITS,
      minVisitors: CLUSTER_MIN_VISITORS,
    },
    format: "JSONEachRow",
  });
  return result.json<ClusterRow>();
};

/** The job body: flag every scripted group for the next 24 hours. */
export const detectScriptedClusters = async (deps: { clickhouse: ClickHouseClient; redis: Redis }) => {
  const rows = await findClusterCandidates(deps.clickhouse);
  let flagged = 0;
  for (const row of rows) {
    if (!isScriptedCluster(row)) continue;
    const key = clusterKey(row.screen, row.browser_family, row.language);
    await deps.redis.set(flagKey(row.website_id, key), "1", "EX", CLUSTER_FLAG_TTL_SECONDS);
    flagged++;
    console.log(
      `[bots] scripted cluster flagged: site=${row.website_id} key=${key} visits=${row.visits} visitors=${row.visitors}`,
    );
  }
  return flagged;
};

/** Ingest check. Redis down means no flag, never a drop. */
export const isFlaggedCluster = async (
  redis: Redis,
  websiteId: string,
  screen: string,
  browserFamily: string,
  language: string,
): Promise<boolean> => {
  const n = await redis.exists(flagKey(websiteId, clusterKey(screen, browserFamily, language))).catch(() => 0);
  return n > 0;
};
