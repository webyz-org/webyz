import { BrowserIcon, DeviceIcon, OSIcon } from "./TechIcons";
import BreakdownCard from "./BreakdownCard";
import type { AnalyticsScope } from "../api";
import { languageName } from "../../../shared/lib/format";

function Row({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-2">
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * Browsers, operating systems and devices, each row with an icon.
 *
 * Versions are not tabs of their own: a browser version only means something
 * next to its browser, so the Browsers tab drills into versions once a browser
 * filter is set, and the OS tab does the same for OS versions. Clicking a row
 * sets that filter, so one click gets you there.
 */
export default function TechnologyCard({ scope }: { scope: AnalyticsScope }) {
  return (
    <BreakdownCard
      scope={scope}
      tabs={[
        {
          key: "browsers",
          label: "Browsers",
          dimension: "browsers",
          valueLabel: "Browser",
          renderName: (row) => (
            <Row icon={<BrowserIcon name={row.name} />} label={row.name ?? "(none)"} />
          ),
          // Drilled rows are this browser's versions, and the API renders them
          // as "Chrome 128", so the same matcher finds the icon.
          renderDrilledName: (row) => (
            <Row icon={<BrowserIcon name={row.name} />} label={row.name ?? "(none)"} />
          ),
        },
        {
          key: "os",
          label: "OS",
          dimension: "os",
          valueLabel: "OS",
          renderName: (row) => (
            <Row icon={<OSIcon name={row.name} />} label={row.name ?? "(none)"} />
          ),
          renderDrilledName: (row) => (
            <Row icon={<OSIcon name={row.name} />} label={row.name ?? "(none)"} />
          ),
        },
        {
          key: "devices",
          label: "Devices",
          dimension: "devices",
          valueLabel: "Device",
          renderName: (row) => (
            <Row icon={<DeviceIcon name={row.name} />} label={row.name ?? "(none)"} />
          ),
        },
        {
          key: "screen_sizes",
          label: "Screen sizes",
          dimension: "screen_sizes",
          valueLabel: "Screen size",
        },
        {
          key: "languages",
          label: "Languages",
          dimension: "languages",
          valueLabel: "Language",
          // Stored as BCP 47 tags; the filter uses the tag, the row reads as a name.
          renderName: (row) => (
            <span className="flex items-baseline gap-2 truncate">
              <span className="truncate">{languageName(row.name)}</span>
              <span className="shrink-0 text-xs text-text-muted">{row.name}</span>
            </span>
          ),
        },
      ]}
    />
  );
}
