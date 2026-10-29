import BreakdownCard from "./BreakdownCard";
import type { AnalyticsScope } from "../api";

export default function ContentsCard({ scope }: { scope: AnalyticsScope }) {
  return (
    <BreakdownCard
      scope={scope}
      detailed
      tabs={[
        { key: "pages", label: "Pages", dimension: "pages", valueLabel: "Page" },
        {
          key: "entries",
          label: "Entry pages",
          dimension: "entries",
          valueLabel: "Entry page",
        },
        {
          key: "exits",
          label: "Exit pages",
          dimension: "exits",
          valueLabel: "Exit page",
        },
        { key: "titles", label: "Titles", dimension: "titles", valueLabel: "Page title" },
        {
          key: "search_terms",
          label: "Site search",
          dimension: "search_terms",
          valueLabel: "Search term",
          searches: true,
        },
        { key: "hostnames", label: "Hostnames", dimension: "hostnames", valueLabel: "Hostname" },
      ]}
    />
  );
}
