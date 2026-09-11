import { ChevronDown, Maximize2, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { TabConfig } from "../types";
import { Dialog, DialogTrigger } from "../../../shared/components/ui/dialog";
import { DataList } from "./DataList";
import { DataModal } from "./DataModal";
import { useResizeObserver } from "../../../shared/hooks/useResizeObserver";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/components/ui/dropdown-menu";

/**
 * Tabbed breakdown card: bordered surface, a 44px header carrying underline
 * tabs and the expand control, then the list. Tabs that do not fit collapse
 * into a "More" menu.
 */
export default function AnalyticsCard<T extends { name?: string; percentage?: number }>({
  tabs,
  activeTab,
  onTabChange,
  open,
  onModalChange,
}: {
  tabs: TabConfig<T>[];
  activeTab: string;
  onTabChange: (key: string) => void;
  open: boolean;
  onModalChange: (open: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  const containerWidth = useResizeObserver(containerRef);

  const [visibleCount, setVisibleCount] = useState(tabs.length);

  // Measure the off-screen copies once per width change and decide how many
  // tabs fit. Storing a count rather than cloned tab objects keeps this in sync
  // when the tab data updates.
  useEffect(() => {
    if (!measureRef.current || containerWidth === 0) {
      return;
    }

    const widths = Array.from(measureRef.current.children).map(
      (el) => (el as HTMLElement).offsetWidth,
    );

    const MORE_BUTTON_WIDTH = 72;
    const TAB_GAP = 16; // matches the gap-4 between tab buttons
    const budget = containerWidth - MORE_BUTTON_WIDTH;

    let used = 0;
    let count = 0;

    for (const width of widths) {
      if (used + width + (count > 0 ? TAB_GAP : 0) > budget) break;
      used += width + (count > 0 ? TAB_GAP : 0);
      count += 1;
    }

    setVisibleCount(Math.max(1, count));
  }, [containerWidth, tabs.length]);

  const visibleTabs = tabs.slice(0, visibleCount);
  const overflowTabs = tabs.slice(visibleCount);

  const active = tabs.find((t) => t.key === activeTab) ?? tabs[0];
  if (!active) return null;

  // Keeps the active tab reachable when it has been pushed into "More".
  const activeInOverflow = overflowTabs.some((t) => t.key === active.key);

  const tabClass = (isActive: boolean) =>
    "relative -mb-px flex h-11 shrink-0 items-center whitespace-nowrap text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-sm " +
    "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-t-full after:transition-colors after:duration-150 " +
    (isActive
      ? "text-text-primary after:bg-text-primary"
      : "text-text-muted hover:text-text-secondary after:bg-transparent");

  const renderBody = () => {
    if (active.error) {
      return (
        <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center">
          <p className="text-[13px] text-text-muted">
            Could not load this breakdown.
          </p>
          {active.onRetry && (
            <button
              type="button"
              onClick={active.onRetry}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-text-secondary transition-colors duration-150 hover:border-border-strong hover:text-text-primary"
            >
              <RotateCw size={12} />
              Retry
            </button>
          )}
        </div>
      );
    }

    if (active.renderCard) {
      return active.renderCard(active.data, active.isLoading);
    }

    return (
      <DataList
        data={active.data}
        isLoading={active.isLoading}
        columns={active.columns}
        maxItems={7}
        onRowClick={active.onRowClick}
      />
    );
  };

  return (
    <section className="flex h-full min-w-0 flex-col rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4">
        <div
          ref={containerRef}
          role="tablist"
          className="flex min-w-0 flex-1 items-center gap-4"
        >
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active.key === tab.key}
              onClick={() => onTabChange(tab.key)}
              className={tabClass(active.key === tab.key)}
            >
              {tab.label}
            </button>
          ))}

          {overflowTabs.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={tabClass(activeInOverflow)}>
                  <span className="flex items-center gap-1">
                    {activeInOverflow ? active.label : "More"}
                    <ChevronDown size={13} />
                  </span>
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end">
                {overflowTabs.map((tab) => (
                  <DropdownMenuItem
                    key={tab.key}
                    onClick={() => onTabChange(tab.key)}
                  >
                    {tab.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <Dialog open={open} onOpenChange={onModalChange}>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label={active.modalTitle}
              title={active.modalTitle}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-black/[0.04] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:hover:bg-white/[0.06]"
            >
              <Maximize2 size={14} />
            </button>
          </DialogTrigger>

          {open && (
            <DataModal
              title={active.modalTitle}
              columns={active.columns}
              data={active.modalData ?? []}
              isLoading={active.modalLoading}
              onRowClick={active.onRowClick}
            />
          )}
        </Dialog>
      </div>

      <div className="min-h-[288px] flex-1 px-4 pb-3 pt-2">{renderBody()}</div>

      {/* Off-screen measuring copies. aria-hidden so screen readers skip them. */}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none absolute -z-10 flex opacity-0"
      >
        {tabs.map((tab) => (
          <span key={tab.key} className="whitespace-nowrap text-[13px] font-medium">
            {tab.label}
          </span>
        ))}
      </div>
    </section>
  );
}
