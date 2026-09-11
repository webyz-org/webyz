import { useState } from "react";

import AnalyticsCard from "./AnalyticsCard";
import { useBreakdown } from "../hooks/useDashboard";
import {
  DIMENSION_FILTERS,
  DRILL_VALUE_LABELS,
  drillDimension,
  useFilters,
} from "../filters";
import type { AnalyticsScope } from "../api";
import type { BreakdownRow, Column, DimensionKey, TabConfig } from "../types";
import { formatCount, formatDuration, formatPercent } from "../../../shared/lib/format";

export type BreakdownTab = {
  key: string;
  label: string;
  dimension: DimensionKey;
  /** Header for the label column. Defaults to the tab label. */
  valueLabel?: string;
  renderName?: (row: BreakdownRow) => React.ReactNode;
  /**
   * Renderer for rows once the tab has drilled into its next level (browser
   * versions, OS versions). Without it a drilled tab falls back to plain text,
   * because the tab's own renderer describes a different dimension.
   */
  renderDrilledName?: (row: BreakdownRow) => React.ReactNode;
};

/**
 * Tabbed breakdown card.
 *
 * Only the active tab is fetched, and the detailed variant only while the
 * expanded modal is open (or always, for cards that show views and bounce
 * inline). That keeps the hook count fixed no matter how many tabs a card
 * declares.
 */
export default function BreakdownCard({
  scope,
  tabs,
  detailed = false,
}: {
  scope: AnalyticsScope;
  tabs: BreakdownTab[];
  /** Show views and bounce rate in the card itself, not only in the modal. */
  detailed?: boolean;
}) {
  const [activeTab, setActiveTab] = useState(tabs[0].key);
  const [open, setOpen] = useState(false);

  const { filters, setFilter } = useFilters();

  const active = tabs.find((t) => t.key === activeTab) ?? tabs[0];

  // Once a dimension is filtered to one value, the tab drills into the next
  // level: a browser filter turns the Browsers tab into that browser's
  // versions, a country filter turns Countries into its regions, and so on.
  const dimension = drillDimension(active.dimension, filters);
  const drilled = dimension !== active.dimension;

  const summary = useBreakdown(scope, dimension, { limit: 7, detailed });
  const modal = useBreakdown(scope, dimension, {
    detailed: true,
    limit: 100,
    enabled: open,
  });

  // Clicking a row filters the whole dashboard by that value. Values are the
  // rendered labels; the API matches them against the same display
  // expressions, so no parsing is needed on either side.
  const filterKey = DIMENSION_FILTERS[dimension];
  const handleRowClick = filterKey
    ? (row: BreakdownRow) => {
        if (!row.name) return;
        setFilter(filterKey, row.name);
        setOpen(false);
      }
    : undefined;

  const columnsFor = (
    tab: BreakdownTab,
    view: "summary" | "detailed" | "modal",
  ): Column<BreakdownRow>[] => {
    const columns: Column<BreakdownRow>[] = [
      {
        key: "name",
        label: drilled
          ? (DRILL_VALUE_LABELS[dimension] ?? tab.valueLabel ?? tab.label)
          : (tab.valueLabel ?? tab.label),
        className: "flex-1 truncate pr-2",
        render: (row) =>
          // A drilled tab shows a different dimension, so the tab's own name
          // renderer (country flags) would mislabel the rows; a tab can pass
          // renderDrilledName for that level instead.
          (drilled ? tab.renderDrilledName?.(row) : tab.renderName?.(row)) ??
          row.name ??
          "(none)",
      },
      {
        key: "visitors",
        label: "Visitors",
        className: view === "summary" ? "w-20 text-right" : "w-16 text-right",
        render: (row) => formatCount(row.visitors),
      },
    ];

    if (view !== "summary") {
      columns.push(
        {
          key: "pageviews",
          label: "Views",
          className: "w-16 text-right",
          render: (row) =>
            row.pageviews === undefined ? "-" : formatCount(row.pageviews),
        },
        {
          key: "bounce_rate",
          label: "Bounce",
          className: "w-14 text-right",
          render: (row) =>
            row.bounce_rate === undefined ? "-" : formatPercent(row.bounce_rate),
        },
      );
    }

    if (view === "modal") {
      columns.push({
        key: "visit_duration",
        label: "Duration",
        className: "w-20 text-right",
        render: (row) =>
          row.visit_duration === undefined
            ? "-"
            : formatDuration(row.visit_duration),
      });
    }

    return columns;
  };

  const tabConfigs: TabConfig<BreakdownRow>[] = tabs.map((tab) => {
    const isActive = tab.key === active.key;

    return {
      key: tab.key,
      label: tab.label,
      data: isActive ? (summary.data?.data ?? []) : [],
      isLoading: isActive ? summary.isLoading : false,
      error: isActive ? summary.isError : false,
      onRetry: isActive ? () => summary.refetch() : undefined,
      modalData: isActive ? (modal.data?.data ?? []) : [],
      modalLoading: isActive ? modal.isLoading : false,
      viewType: "list",
      modalTitle:
        isActive && drilled
          ? `All ${(DRILL_VALUE_LABELS[dimension] ?? tab.label).toLowerCase()}s`
          : `All ${tab.label.toLowerCase()}`,
      columns: columnsFor(tab, open ? "modal" : detailed ? "detailed" : "summary"),
      onRowClick: isActive ? handleRowClick : undefined,
    };
  });

  return (
    <AnalyticsCard
      tabs={tabConfigs}
      activeTab={active.key}
      onTabChange={(key) => {
        setActiveTab(key);
        setOpen(false);
      }}
      open={open}
      onModalChange={setOpen}
    />
  );
}
