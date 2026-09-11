import { AppContext } from "../../lib/context.js";
import {
  JourneyMetric,
  journeyEventsQuery,
  journeyStartingPointsQuery,
  journeyStepsQuery,
} from "../../db/clickhouse/journeys.js";

/**
 * Journey aggregation. The semantics (what a step is, how journeys are rooted,
 * what volume counts) live in db/clickhouse/journeys.ts next to the SQL; this
 * layer only orchestrates the queries and shapes the response.
 */

const STARTING_POINT_LIMIT = 10;
const BRANCH_LIMIT = 8;
const EVENTS_PER_COLUMN = 5;

export type JourneyNode = {
  path: string;
  volume: number;
  /** volume / starting-point volume * 100, from raw volumes, 1 decimal. */
  percentage: number;
};

export type JourneyStep = {
  depth: number;
  paths: JourneyNode[];
  /**
   * Custom events fired on the dominant path of the PREVIOUS depth by the
   * sessions in this journey - shown as "Events on <path>" under the column
   * they lead into. Null when there are none.
   */
  events: { path: string; items: { name: string; volume: number }[] } | null;
};

export type JourneysResult = {
  metric: JourneyMetric;
  depth: number;
  startingPoints: { path: string; volume: number }[];
  startingPoint: { path: string; volume: number } | null;
  steps: JourneyStep[];
};

export const getJourneys = async (
  ctx: AppContext,
  input: {
    websiteId: string;
    from: number;
    to: number;
    metric: JourneyMetric;
    startingPath?: string;
    depth: number;
  },
): Promise<JourneysResult> => {
  const base = {
    websiteId: input.websiteId,
    from: input.from,
    to: input.to,
    metric: input.metric,
  };

  const startingPoints = await journeyStartingPointsQuery(ctx.clickhouse, {
    ...base,
    limit: STARTING_POINT_LIMIT,
  });

  // Default to the busiest starting point, which is usually "/".
  const startingPath = input.startingPath || startingPoints[0]?.path;

  if (!startingPath) {
    return {
      metric: input.metric,
      depth: input.depth,
      startingPoints: [],
      startingPoint: null,
      steps: [],
    };
  }

  const [stepRows, eventRows] = await Promise.all([
    journeyStepsQuery(ctx.clickhouse, {
      ...base,
      startingPath,
      depth: input.depth,
      branchLimit: BRANCH_LIMIT,
    }),
    journeyEventsQuery(ctx.clickhouse, { ...base, startingPath }),
  ]);

  const rootVolume =
    stepRows.find((r) => r.depth === 0 && r.path === startingPath)?.volume ?? 0;

  const eventsByPath = new Map<string, { name: string; volume: number }[]>();
  for (const row of eventRows) {
    const list = eventsByPath.get(row.path) ?? [];
    if (list.length < EVENTS_PER_COLUMN) {
      list.push({ name: row.name, volume: row.volume });
    }
    eventsByPath.set(row.path, list);
  }

  const steps: JourneyStep[] = [];
  for (let depth = 0; depth <= input.depth; depth++) {
    const paths = stepRows
      .filter((r) => r.depth === depth)
      .map((r) => ({
        path: r.path,
        volume: r.volume,
        percentage:
          rootVolume > 0 ? Math.round((r.volume / rootVolume) * 1000) / 10 : 0,
      }));

    // Depths past the longest journey carry no data; stop rather than
    // rendering empty columns.
    if (paths.length === 0) break;

    // Events explaining the transition INTO this column happened on the
    // previous column's dominant path.
    const previousTop = depth > 0 ? steps[depth - 1]?.paths[0]?.path : undefined;
    const items = previousTop ? eventsByPath.get(previousTop) : undefined;

    steps.push({
      depth,
      paths,
      events: previousTop && items?.length ? { path: previousTop, items } : null,
    });
  }

  return {
    metric: input.metric,
    depth: input.depth,
    startingPoints,
    startingPoint: { path: startingPath, volume: rootVolume },
    steps,
  };
};
