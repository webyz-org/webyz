import { History } from "lucide-react";

import type { AnalyticsScope } from "../api";
import { useTopStats } from "../hooks/useDashboard";

/**
 * One quiet line under the overview when the period reaches into imported
 * history (Google Analytics 4 or Plausible): either it is in the numbers, or a filter left it
 * out and the numbers above cover tracked days only. Reads the status the
 * top-stats request already carries, so it costs no request of its own.
 */
export default function ImportedDataNote({ scope }: { scope: AnalyticsScope }) {
  const { data } = useTopStats(scope);
  if (!data?.imported || data.imported === "off") return null;

  return (
    <p className="mt-1 flex items-center gap-1.5 px-1 text-[12px] text-text-muted">
      <History size={13} className="shrink-0" aria-hidden />
      <span>
        {data.imported === "included"
          ? "Includes imported history for the days before Webyz tracking began."
          : "Imported history is not shown for this filter: it holds daily totals per report, so a filter from one report cannot narrow another (country is India, viewed by browser)."}
      </span>
    </p>
  );
}
