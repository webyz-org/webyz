import { useState } from "react";
import { Link } from "react-router";

import AnalyticsCard from "./AnalyticsCard";
import { DataList } from "./DataList";
import {
  useConversions,
  useCustomEventProperties,
  useCustomEvents,
} from "../hooks/useDashboard";
import { useFilters } from "../filters";
import type { AnalyticsScope } from "../api";
import type { Column, TabConfig } from "../types";
import { formatCount, formatPercent } from "../../../shared/lib/format";

type Row = {
  name: string;
  visitors: number;
  percentage: number;
  completions: number;
  conversion_rate?: number;
};

/**
 * Goals and custom events, plus the properties of a custom event once one is
 * filtered in.
 *
 * Goals come from the Goal table joined against event counts, so a site with
 * no goals configured sees a prompt to create one rather than an empty table.
 * Clicking a goal or an event row filters the whole dashboard to sessions
 * that converted, the same as clicking a browser filters to that browser.
 * With an event filter active a Properties tab appears: pick a property key
 * and the values are broken down by visitors, so "Signup by plan" is two
 * clicks.
 */
export default function ConversionCard({
  scope,
  siteDomain,
}: {
  scope: AnalyticsScope;
  siteDomain?: string;
}) {
  const [activeTab, setActiveTab] = useState("goals");
  const [open, setOpen] = useState(false);
  const [propertyKey, setPropertyKey] = useState<string | undefined>();

  const { filters, setFilter } = useFilters();
  const filteredEvent = filters.event?.op === "is" ? filters.event.value : undefined;
  const showProperties = Boolean(filteredEvent);
  const tab = activeTab === "properties" && !showProperties ? "goals" : activeTab;

  const conversions = useConversions(scope, tab === "goals");
  const customEvents = useCustomEvents(scope, tab === "events");
  const propertyKeys = useCustomEventProperties(scope, filteredEvent, undefined, tab === "properties");
  const propertyValues = useCustomEventProperties(
    scope,
    filteredEvent,
    propertyKey,
    tab === "properties" && Boolean(propertyKey),
  );

  const goalRows: Row[] = (conversions.data ?? []).map((c) => ({
    name: c.name,
    visitors: c.visitors,
    completions: c.completions,
    conversion_rate: c.conversion_rate,
    percentage: c.conversion_rate,
  }));

  const eventRows: Row[] = (customEvents.data ?? []).map((e) => ({
    name: e.name,
    visitors: e.visitors,
    completions: e.completions,
    percentage: e.percentage,
  }));

  // Without a chosen key the tab lists the keys themselves, so the person
  // sees what the event carries before picking one.
  const keys = propertyKeys.data ?? [];
  const activeKey = propertyKey && keys.some((k) => k.name === propertyKey) ? propertyKey : undefined;
  const propertyRows: Row[] = ((activeKey ? propertyValues.data : propertyKeys.data) ?? []).map(
    (p) => ({
      name: p.name,
      visitors: p.visitors,
      completions: p.events,
      percentage: p.percentage,
    }),
  );

  const goalColumns: Column<Row>[] = [
    {
      key: "name",
      label: "Goal",
      className: "flex-1 truncate pr-2",
      render: (row) => row.name,
    },
    {
      key: "visitors",
      label: "Visitors",
      className: "w-24 text-right",
      render: (row) => formatCount(row.visitors),
    },
    {
      key: "rate",
      label: "CR",
      className: "w-20 text-right",
      render: (row) => formatPercent(row.conversion_rate ?? 0),
    },
  ];

  const eventColumns: Column<Row>[] = [
    {
      key: "name",
      label: "Event",
      className: "flex-1 truncate pr-2",
      render: (row) => row.name,
    },
    {
      key: "visitors",
      label: "Visitors",
      className: "w-24 text-right",
      render: (row) => formatCount(row.visitors),
    },
    {
      key: "completions",
      label: "Total",
      className: "w-20 text-right",
      render: (row) => formatCount(row.completions),
    },
  ];

  const propertyColumns: Column<Row>[] = [
    {
      key: "name",
      label: activeKey ? activeKey : "Property",
      className: "flex-1 truncate pr-2",
      render: (row) => row.name || "(empty)",
    },
    {
      key: "visitors",
      label: "Visitors",
      className: "w-24 text-right",
      render: (row) => formatCount(row.visitors),
    },
    {
      key: "completions",
      label: "Events",
      className: "w-20 text-right",
      render: (row) => formatCount(row.completions),
    },
  ];

  const noGoals = !conversions.isLoading && goalRows.length === 0;

  const propertyPicker = (
    <div className="flex items-center gap-2 px-1 pb-2 text-xs text-text-muted">
      <span className="truncate">
        <span className="font-medium text-text-primary">{filteredEvent}</span>
        {activeKey ? " by" : " properties"}
      </span>
      {keys.length > 0 && (
        <select
          value={activeKey ?? ""}
          onChange={(e) => setPropertyKey(e.target.value || undefined)}
          aria-label="Property"
          className="ml-auto max-w-[50%] truncate rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-primary"
        >
          <option value="">All properties</option>
          {keys.map((k) => (
            <option key={k.name} value={k.name}>
              {k.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );

  const tabs: TabConfig<Row>[] = [
    {
      key: "goals",
      label: "Goals",
      data: goalRows,
      isLoading: conversions.isLoading,
      modalData: goalRows,
      modalLoading: conversions.isLoading,
      viewType: "list",
      modalTitle: "All goals",
      columns: goalColumns,
      onRowClick: (row) => {
        setFilter("goal", row.name);
        setOpen(false);
      },
      renderCard: noGoals
        ? () => (
            <div className="py-6 text-center">
              <p className="text-sm text-text-muted">No goals configured yet.</p>
              {siteDomain && (
                <Link
                  to={`/sites/${siteDomain}/settings`}
                  className="mt-2 inline-block text-sm text-primary hover:underline"
                >
                  Set up a goal
                </Link>
              )}
            </div>
          )
        : undefined,
    },
    {
      key: "events",
      label: "Custom events",
      data: eventRows,
      isLoading: customEvents.isLoading,
      modalData: eventRows,
      modalLoading: customEvents.isLoading,
      viewType: "list",
      modalTitle: "All custom events",
      columns: eventColumns,
      onRowClick: (row) => {
        setFilter("event", row.name);
        setActiveTab("properties");
        setPropertyKey(undefined);
        setOpen(false);
      },
    },
  ];

  if (showProperties) {
    tabs.push({
      key: "properties",
      label: "Properties",
      data: propertyRows,
      isLoading: activeKey ? propertyValues.isLoading : propertyKeys.isLoading,
      modalData: propertyRows,
      modalLoading: activeKey ? propertyValues.isLoading : propertyKeys.isLoading,
      viewType: "list",
      modalTitle: activeKey ? `${filteredEvent}: ${activeKey}` : `${filteredEvent} properties`,
      columns: propertyColumns,
      // Clicking a key row drills into its values; value rows are terminal.
      onRowClick: activeKey ? undefined : (row) => setPropertyKey(row.name),
      renderCard:
        !propertyKeys.isLoading && keys.length === 0
          ? () => (
              <div className="py-6 text-center text-sm text-text-muted">
                This event was sent without properties in this period.
              </div>
            )
          : (data, isLoading) => (
              <>
                {propertyPicker}
                <DataList
                  data={data}
                  isLoading={isLoading}
                  columns={propertyColumns}
                  onRowClick={activeKey ? undefined : (row) => setPropertyKey(row.name)}
                />
              </>
            ),
    });
  }

  return (
    <AnalyticsCard
      tabs={tabs}
      activeTab={tab}
      onTabChange={(key) => {
        setActiveTab(key);
        setOpen(false);
      }}
      open={open}
      onModalChange={setOpen}
    />
  );
}

export { DataList };
