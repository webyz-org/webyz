import StatGrid from "../../../shared/components/StatGrid";
import { formatCount, formatDuration, formatPercent } from "../../../shared/lib/format";
import type { PagesSummary as Summary } from "../types";

/** The compact answer strip above the table, same visual grid as TopStats. */
export default function PagesSummary({
  summary,
  isLoading,
}: {
  summary?: Summary;
  isLoading: boolean;
}) {
  const cells = [
    { label: "Pages", value: formatCount(summary?.pages ?? 0) },
    { label: "Pageviews", value: formatCount(summary?.pageviews ?? 0) },
    { label: "Sessions", value: formatCount(summary?.sessions ?? 0) },
    { label: "Avg. bounce", value: formatPercent(summary?.bounce_rate ?? 0) },
    {
      label: "Avg. duration",
      value: formatDuration(summary?.avg_duration ?? 0),
    },
    { label: "Top page", value: summary?.top_page ?? "—", truncate: true },
  ];

  return <StatGrid cells={cells} isLoading={isLoading && !summary} />;
}
