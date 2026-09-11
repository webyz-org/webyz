/**
 * Dashboard drill-down filters (Plausible style): clicking a breakdown row
 * narrows every query on the page to sessions matching that value.
 *
 * This is an allowlist on purpose. The filter key selects a fixed SQL
 * expression, the value is always bound as a query parameter, so a filter can
 * never inject SQL. Each expression matches the *display label* the breakdown
 * renders ("Chrome 120", "(direct)", "Direct"), so the frontend sends back
 * exactly the name the user clicked with no client-side parsing.
 *
 * Every filter carries an operator. `is` is the click-to-drill default; the
 * others exist for the manual filter form and the API: `is_not`, `contains`
 * and `not_contains` (both case-insensitive substring matches). Over the wire
 * the operator is a value prefix (see `parseFilterValue`), so `f.page=/pricing`
 * keeps working unchanged.
 */

export type FilterOperator = "is" | "is_not" | "contains" | "not_contains";

export type FilterCondition = { op: FilterOperator; value: string };

type FilterSpec = {
  /** Session columns that must survive argMax deduplication for the match. */
  columns: string[];
  /** SQL expression producing the display label, evaluated over deduped rows. */
  expr: string;
};

const col = (column: string): FilterSpec => ({ columns: [column], expr: column });

const SESSION_FILTERS = {
  browser: col("browser_family"),
  browser_version: {
    columns: ["browser_family", "browser_version"],
    expr: "concat(browser_family, ' ', browser_version)",
  },
  os: col("os_family"),
  os_version: {
    columns: ["os_family", "os_version"],
    expr: "concat(os_family, ' ', os_version)",
  },
  // Matches the display expression in breakdown.ts, which folds case.
  device: { columns: ["device_type"], expr: "initcap(lower(device_type))" },
  screen: col("screen"),
  language: col("language"),
  entry_page: col("entry_page"),
  exit_page: col("exit_page"),
  // Old rows store '' for direct traffic, new rows the literal label, and the
  // breakdown renders both the same way; match on the rendered label.
  channel: { columns: ["channel"], expr: "if(channel = '', 'Direct', channel)" },
  source: {
    columns: ["referrer_domain"],
    expr: "if(referrer_domain = '', '(direct)', referrer_domain)",
  },
  utm_source: col("utm_source"),
  utm_medium: col("utm_medium"),
  utm_campaign: col("utm_campaign"),
  utm_content: col("utm_content"),
  utm_term: col("utm_term"),
  country: col("country"),
  region: col("sub_division_1"),
  city: col("city"),
} satisfies Record<string, FilterSpec>;

export type SessionFilterKey = keyof typeof SESSION_FILTERS;

/**
 * `page` and `event` are not session attributes: they restrict to sessions
 * that viewed the page, or fired the custom event, at least once, via the
 * events table. A `goal` filter from the API is resolved by the controller
 * into one of these two before it gets here.
 */
export type EventFilterKey = "page" | "event";
export type FilterKey = SessionFilterKey | EventFilterKey;

export type AnalyticsFilters = Partial<Record<FilterKey, FilterCondition>>;

export const FILTER_KEYS = [
  ...(Object.keys(SESSION_FILTERS) as SessionFilterKey[]),
  "page",
  "event",
] as const satisfies readonly FilterKey[];

export const isFilterKey = (key: string): key is FilterKey =>
  (FILTER_KEYS as readonly string[]).includes(key);

/**
 * Wire format of one filter value. The operator is a prefix so equality, the
 * overwhelmingly common case, stays a bare value:
 *
 *   /pricing      is
 *   !/pricing     is not
 *   ~pricing      contains
 *   !~pricing     does not contain
 *   =!literal     is, for a value that itself starts with ! ~ or =
 *   !=~literal    is not, same escape after the operator marker
 */
export const parseFilterValue = (raw: string): FilterCondition | null => {
  let op: FilterOperator = "is";
  let value = raw;
  if (raw.startsWith("!~")) {
    op = "not_contains";
    value = raw.slice(2);
  } else if (raw.startsWith("!")) {
    op = "is_not";
    value = raw.slice(1);
  } else if (raw.startsWith("~")) {
    op = "contains";
    value = raw.slice(1);
  }
  // A leading "=" after the operator marker escapes a literal that itself
  // starts with ! ~ or =, for every operator alike.
  if (value.startsWith("=")) value = value.slice(1);
  if (value === "") return null;
  return { op, value };
};

/** Inverse of parseFilterValue, for links and saved segments. */
const OPERATOR_MARKER: Record<FilterOperator, string> = {
  is: "",
  is_not: "!",
  contains: "~",
  not_contains: "!~",
};

export const formatFilterValue = ({ op, value }: FilterCondition): string =>
  `${OPERATOR_MARKER[op]}${/^[!~=]/.test(value) ? "=" : ""}${value}`;

const isNegative = (op: FilterOperator) => op === "is_not" || op === "not_contains";

/**
 * Predicate for `expr <op> {param}`. Substring matches fold case, because a
 * person typing "pricing" means every page with pricing in it.
 */
const predicate = (expr: string, op: FilterOperator, param: string): string => {
  switch (op) {
    case "is":
      return `${expr} = {${param}:String}`;
    case "is_not":
      return `${expr} != {${param}:String}`;
    case "contains":
      return `positionCaseInsensitive(${expr}, {${param}:String}) > 0`;
    case "not_contains":
      return `positionCaseInsensitive(${expr}, {${param}:String}) = 0`;
  }
};

/**
 * SQL fragments for the query window, because callers bind their time bounds
 * under different names and types (UInt32 epoch vs DateTime).
 */
export type TimeExprs = { fromExpr: string; toExpr: string };

/** The common case: `from`/`to` bound as Unix seconds. */
export const UNIX_TIME_EXPRS: TimeExprs = {
  fromExpr: "fromUnixTimestamp({from:UInt32})",
  toExpr: "fromUnixTimestamp({to:UInt32})",
};

export type BuiltSessionFilters = {
  /** Extra columns the dedupe CTE must carry (argMax) for the predicates. */
  columns: string[];
  /** Predicates to apply over the deduped rows. */
  clauses: string[];
  /** "" or `AND session_id [NOT] IN (...)` clauses for the page/event filters. */
  pageRestriction: string;
};

/**
 * `AND session_id IN (...)` (or NOT IN, for a negative operator) over the
 * events table. A negative page filter means "sessions that never viewed a
 * matching page", which is what "page is not /x" reads as on a dashboard.
 */
const eventsRestriction = (
  matcher: string,
  negative: boolean,
  time: TimeExprs,
): string => `
        AND session_id ${negative ? "NOT IN" : "IN"} (
          SELECT DISTINCT session_id
          FROM events
          WHERE website_id = {websiteId:String}
            AND ${matcher}
            AND timestamp >= ${time.fromExpr}
            AND timestamp <  ${time.toExpr}
        )`;

/**
 * Translate filters into SQL pieces for a sessions-table query, binding every
 * value into `queryParams` under a `flt_` prefixed name. The caller must bind
 * `websiteId` and the time bounds referenced by `time` itself.
 */
export const buildSessionFilters = (
  filters: AnalyticsFilters | undefined,
  queryParams: Record<string, unknown>,
  time: TimeExprs = UNIX_TIME_EXPRS,
): BuiltSessionFilters => {
  const columns = new Set<string>();
  const clauses: string[] = [];
  let pageRestriction = "";

  for (const [key, condition] of Object.entries(filters ?? {})) {
    if (!condition || condition.value === "") continue;
    const { op, value } = condition;
    const positiveOp: FilterOperator =
      op === "contains" || op === "not_contains" ? "contains" : "is";

    if (key === "page") {
      queryParams.flt_page = value;
      pageRestriction += eventsRestriction(
        `event_type = 'pageview' AND ${predicate("url_path", positiveOp, "flt_page")}`,
        isNegative(op),
        time,
      );
      continue;
    }

    if (key === "event") {
      queryParams.flt_event = value;
      pageRestriction += eventsRestriction(
        `event_type = 'event' AND ${predicate("event_name", positiveOp, "flt_event")}`,
        isNegative(op),
        time,
      );
      continue;
    }

    const spec: FilterSpec | undefined = SESSION_FILTERS[key as SessionFilterKey];
    if (!spec) continue;

    const param = `flt_${key}`;
    queryParams[param] = value;
    for (const column of spec.columns) columns.add(column);
    clauses.push(predicate(spec.expr, op, param));
  }

  return { columns: [...columns], clauses, pageRestriction };
};

/**
 * For events-table queries (goals, custom events): "" or an
 * `AND session_id IN (...)` clause keeping only events whose session matches
 * every filter. Sessions are deduplicated inside the subquery, so a stale
 * ReplacingMergeTree row can neither admit nor exclude a session wrongly.
 */
export const buildEventsSessionRestriction = (
  filters: AnalyticsFilters | undefined,
  queryParams: Record<string, unknown>,
  time: TimeExprs = UNIX_TIME_EXPRS,
): string => {
  const built = buildSessionFilters(filters, queryParams, time);
  if (!built.clauses.length && !built.pageRestriction) return "";

  const dedupColumns = built.columns
    .map((column) => `argMax(${column}, updated_at) AS ${column}`)
    .join(",\n              ");

  const where = built.clauses.length
    ? `WHERE ${built.clauses.join(" AND ")}`
    : "";

  return `
        AND session_id IN (
          SELECT session_id FROM (
            SELECT
              session_id${dedupColumns ? `,\n              ${dedupColumns}` : ""}
            FROM sessions
            WHERE website_id = {websiteId:String}
              AND start_time < ${time.toExpr}
              AND end_time >= ${time.fromExpr}${built.pageRestriction}
            GROUP BY session_id
          ) ${where}
        )`;
};
