import { get, getPaged } from "../../lib/axios";
import type { AnalyticsScope } from "../dashboard/api";
import type {
  PageDetailResponse,
  PagesResponse,
  PagesSortKey,
  PagesSortOrder,
} from "./types";

const scopeParams = (scope: AnalyticsScope) => ({
  period: scope.period,
  ...(scope.from ? { from: scope.from } : {}),
  ...(scope.to ? { to: scope.to } : {}),
});

export type PagesQuery = {
  search?: string;
  sort: PagesSortKey;
  order: PagesSortOrder;
  page: number;
  limit: number;
};

/** Pagination rides in the envelope meta like every paged endpoint; fold it
 * back into one object so callers get summary, rows and paging together. */
export const getPages = async (
  scope: AnalyticsScope,
  query: PagesQuery,
): Promise<PagesResponse> => {
  const res = await getPaged<Omit<PagesResponse, "meta">>(
    `/${scope.siteId}/pages`,
    {
      ...scopeParams(scope),
      ...(query.search ? { search: query.search } : {}),
      sort: query.sort,
      order: query.order,
      page: query.page,
      limit: query.limit,
    },
  );

  return {
    ...res.data,
    meta: res.meta as unknown as PagesResponse["meta"],
  };
};

export const getPageDetail = (scope: AnalyticsScope, path: string) =>
  get<PageDetailResponse>(`/${scope.siteId}/pages/detail`, {
    ...scopeParams(scope),
    path,
  });
