import BreakdownCard from "./BreakdownCard";
import type { AnalyticsScope } from "../api";

export default function AcquisitionCard({ scope }: { scope: AnalyticsScope }) {
  return (
    <BreakdownCard
      scope={scope}
      tabs={[
        {
          key: "channel",
          label: "Channels",
          dimension: "channel",
          valueLabel: "Channel",
        },
        {
          key: "source",
          label: "Sources",
          dimension: "source",
          valueLabel: "Referrer",
        },
        {
          key: "utm_source",
          label: "UTM sources",
          dimension: "utm_source",
          valueLabel: "Source",
        },
        {
          key: "utm_medium",
          label: "UTM mediums",
          dimension: "utm_medium",
          valueLabel: "Medium",
        },
        {
          key: "utm_campaign",
          label: "Campaigns",
          dimension: "utm_campaign",
          valueLabel: "Campaign",
        },
        {
          key: "utm_content",
          label: "Contents",
          dimension: "utm_content",
          valueLabel: "Content",
        },
        {
          key: "utm_term",
          label: "Terms",
          dimension: "utm_term",
          valueLabel: "Term",
        },
      ]}
    />
  );
}
