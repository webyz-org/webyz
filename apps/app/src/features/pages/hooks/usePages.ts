import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getPageDetail, getPages, type PagesQuery } from "../api";
import type { AnalyticsScope } from "../../dashboard/api";

/** Same cache-key prefix as useDashboard so a site invalidates together. */
const scopeKey = (scope: AnalyticsScope) => [
  "analytics",
  scope.siteId,
  scope.period,
  scope.from ?? null,
  scope.to ?? null,
];

export const usePages = (scope: AnalyticsScope, query: PagesQuery) =>
  useQuery({
    queryKey: [
      ...scopeKey(scope),
      "pages",
      query.search ?? "",
      query.sort,
      query.order,
      query.page,
      query.limit,
    ],
    queryFn: () => getPages(scope, query),
    enabled: Boolean(scope.siteId),
    // Keep the previous table on screen while a sort/search/page loads, so
    // the layout does not collapse to a skeleton on every keystroke.
    placeholderData: (previous) => previous,
  });

export const usePageDetail = (scope: AnalyticsScope, path?: string) =>
  useQuery({
    queryKey: [...scopeKey(scope), "page-detail", path],
    queryFn: () => getPageDetail(scope, path!),
    enabled: Boolean(scope.siteId) && Boolean(path),
    placeholderData: (previous) => previous,
  });

/** Debounce the search box so typing does not fire a request per keystroke. */
export const useDebouncedValue = <T>(value: T, delayMs = 300): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
};
