import BreakdownCard from "./BreakdownCard";
import type { AnalyticsScope } from "../api";
import { countryFlag, countryName } from "../../../shared/lib/format";

/**
 * Countries, regions and cities. Countries arrive as ISO-3166 alpha-2 codes
 * from ClickHouse, so they are expanded to names with a flag for scanning.
 */
export default function GeographyCard({ scope }: { scope: AnalyticsScope }) {
  return (
    <BreakdownCard
      scope={scope}
      tabs={[
        {
          key: "countries",
          label: "Countries",
          dimension: "countries",
          valueLabel: "Country",
          renderName: (row) => (
            <span className="flex items-center gap-2">
              <span aria-hidden>{countryFlag(row.name)}</span>
              <span className="truncate">{countryName(row.name)}</span>
            </span>
          ),
        },
        {
          key: "regions",
          label: "Regions",
          dimension: "regions",
          valueLabel: "Region",
        },
        {
          key: "cities",
          label: "Cities",
          dimension: "cities",
          valueLabel: "City",
        },
      ]}
    />
  );
}
