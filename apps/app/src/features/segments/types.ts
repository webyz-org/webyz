/**
 * A saved segment: a named set of dashboard filters on one site. `filters` is
 * the wire form the API and the URL share (`{ browser: "Chrome",
 * page: "!~/admin" }`), so applying one parses each value with
 * `parseFilterValue` and saving one sends `filtersToWire` unchanged.
 */
export type Segment = {
  id: string;
  websiteId: string;
  name: string;
  filters: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type SegmentInput = {
  name: string;
  filters: Record<string, string>;
};
