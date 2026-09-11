import { useSearchParams } from "react-router";

import { DEFAULT_PERIOD } from "../../config/periods";

export type PeriodRange = { from: string; to: string };

/**
 * The reporting period as URL state, shared by every analytics page: `period`
 * plus, for period=custom, `from`/`to` as YYYY-MM-DD. Changing the period
 * also drops any `page` pagination param, since the old page number is
 * meaningless in a new window.
 */
export function usePeriod() {
  const [searchParams, setSearchParams] = useSearchParams();

  const period = searchParams.get("period") ?? DEFAULT_PERIOD;
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;

  const setPeriod = (next: string, range?: PeriodRange) => {
    const params = new URLSearchParams(searchParams);
    params.set("period", next);
    if (next === "custom" && range) {
      params.set("from", range.from);
      params.set("to", range.to);
    } else {
      params.delete("from");
      params.delete("to");
    }
    params.delete("page");
    setSearchParams(params, { replace: true });
  };

  return { period, from, to, setPeriod };
}

/** Query-string suffix carrying the current period into another page's link. */
export const periodQuery = (period: string, from?: string, to?: string) =>
  `period=${period}` +
  (period === "custom" && from && to ? `&from=${from}&to=${to}` : "");
