import { useSearchParams } from "react-router";

import type { DimensionKey } from "./types";

/**
 * Dashboard drill-down filters, Plausible style: clicking a breakdown row
 * filters the whole dashboard by that value, and active filters show as
 * removable pills above the graph.
 *
 * Filters live in the URL as `f.<key>=<value>` params so a filtered view is
 * linkable, survives reload, and works on public share pages. The `f.` prefix
 * keeps them clear of `period`/`from`/`to`/`page`, and the API reads the same
 * names. Values are the exact labels the API renders ("Chrome 120",
 * "(direct)"), so no parsing happens on either side.
 *
 * Each filter carries an operator. Clicking a row applies `is`; the filter
 * form offers the rest. On the wire the operator is a prefix on the value,
 * the same encoding the API accepts: `!` is not, `~` contains, `!~` does not
 * contain, and `=` escapes a literal value that starts with one of those.
 */
export const FILTER_LABELS = {
  page: "Page",
  entry_page: "Entry page",
  exit_page: "Exit page",
  goal: "Goal",
  event: "Event",
  channel: "Channel",
  source: "Source",
  utm_source: "UTM source",
  utm_medium: "UTM medium",
  utm_campaign: "UTM campaign",
  utm_content: "UTM content",
  utm_term: "UTM term",
  browser: "Browser",
  browser_version: "Browser version",
  os: "OS",
  os_version: "OS version",
  device: "Device",
  screen: "Screen size",
  language: "Language",
  country: "Country",
  region: "Region",
  city: "City",
} as const;

export type FilterKey = keyof typeof FILTER_LABELS;

export type FilterOperator = "is" | "is_not" | "contains" | "not_contains";

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  not_contains: "does not contain",
};

export type FilterCondition = { op: FilterOperator; value: string };
export type Filters = Partial<Record<FilterKey, FilterCondition>>;

const PARAM_PREFIX = "f.";

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
  return value ? { op, value } : null;
};

const OPERATOR_MARKER: Record<FilterOperator, string> = {
  is: "",
  is_not: "!",
  contains: "~",
  not_contains: "!~",
};

export const formatFilterValue = ({ op, value }: FilterCondition): string =>
  `${OPERATOR_MARKER[op]}${/^[!~=]/.test(value) ? "=" : ""}${value}`;

/** The `f.*` entries of a search-params object, as conditions. */
export const filtersFromParams = (params: URLSearchParams): Filters => {
  const filters: Filters = {};
  for (const key of Object.keys(FILTER_LABELS) as FilterKey[]) {
    const raw = params.get(PARAM_PREFIX + key);
    const condition = raw ? parseFilterValue(raw) : null;
    if (condition) filters[key] = condition;
  }
  return filters;
};

/** The wire form the API takes: `{ browser: "Chrome", page: "!~/admin" }`. */
export const filtersToWire = (filters: Filters): Record<string, string> =>
  Object.fromEntries(
    Object.entries(filters).map(([key, condition]) => [
      key,
      formatFilterValue(condition as FilterCondition),
    ]),
  );

/** Query-string fragment (`f.browser=Chrome&f.page=...`) for links. */
export const filtersToQuery = (filters: Filters): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filtersToWire(filters))) {
    params.set(PARAM_PREFIX + key, value);
  }
  return params.toString();
};

export function useFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = filtersFromParams(searchParams);

  const setFilter = (key: FilterKey, value: string, op: FilterOperator = "is") => {
    if (!value) return;
    const params = new URLSearchParams(searchParams);
    params.set(PARAM_PREFIX + key, formatFilterValue({ op, value }));
    params.delete("page");
    setSearchParams(params);
  };

  const removeFilter = (key: FilterKey) => {
    const params = new URLSearchParams(searchParams);
    params.delete(PARAM_PREFIX + key);
    params.delete("page");
    setSearchParams(params);
  };

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams);
    for (const key of Object.keys(FILTER_LABELS)) {
      params.delete(PARAM_PREFIX + key);
    }
    params.delete("page");
    setSearchParams(params);
  };

  /** Replace every filter at once (applying a saved segment). */
  const replaceFilters = (next: Filters) => {
    const params = new URLSearchParams(searchParams);
    for (const key of Object.keys(FILTER_LABELS)) {
      params.delete(PARAM_PREFIX + key);
    }
    for (const [key, value] of Object.entries(filtersToWire(next))) {
      params.set(PARAM_PREFIX + key, value);
    }
    params.delete("page");
    setSearchParams(params);
  };

  return {
    filters,
    /** What the API calls take. */
    wire: filtersToWire(filters),
    hasFilters: Object.keys(filters).length > 0,
    setFilter,
    removeFilter,
    clearFilters,
    replaceFilters,
  };
}

/** The filter a click on a row of this dimension applies. */
export const DIMENSION_FILTERS: Partial<Record<DimensionKey, FilterKey>> = {
  pages: "page",
  entries: "entry_page",
  exits: "exit_page",
  browsers: "browser",
  browser_versions: "browser_version",
  os: "os",
  os_versions: "os_version",
  devices: "device",
  screen_sizes: "screen",
  languages: "language",
  channel: "channel",
  source: "source",
  utm_source: "utm_source",
  utm_medium: "utm_medium",
  utm_campaign: "utm_campaign",
  utm_content: "utm_content",
  utm_term: "utm_term",
  countries: "country",
  regions: "region",
  cities: "city",
};

/**
 * Drill-down: once a dimension is filtered to one value, its tab shows the
 * next level instead (browser -> versions, country -> regions -> cities),
 * which is what makes clicking Chrome reveal Chrome's versions in place.
 * Only an `is` filter drills; "browser is not Chrome" still lists browsers.
 */
export const drillDimension = (
  dimension: DimensionKey,
  filters: Filters,
): DimensionKey => {
  const isSet = (key: FilterKey) => filters[key]?.op === "is";
  if (dimension === "browsers" && isSet("browser")) return "browser_versions";
  if (dimension === "os" && isSet("os")) return "os_versions";
  if (dimension === "countries") {
    if (isSet("region")) return "cities";
    if (isSet("country")) return "regions";
  }
  if (dimension === "regions" && isSet("region")) return "cities";
  return dimension;
};

/** Column header / modal naming for dimensions reached only by drilling. */
export const DRILL_VALUE_LABELS: Partial<Record<DimensionKey, string>> = {
  browser_versions: "Version",
  os_versions: "Version",
  regions: "Region",
  cities: "City",
};
