import { Zap } from "lucide-react";

import type { JourneysResponse } from "../types";

/**
 * Horizontal journey visualization: column 0 lists starting points, columns
 * 1..n show where the rooted journeys went next. Clicking any node re-roots
 * the journey at that path.
 *
 * Column geometry is fixed (header 28px, node 44px + 8px gap) so the
 * connector lines between a column's top node and the next column can be
 * plain absolutely-positioned rules instead of measured SVG.
 */

const COLUMN_WIDTH = "w-64";
const HEADER_PX = 28;
const NODE_PX = 44;

const formatVolume = (n: number) => n.toLocaleString();

const formatPercentage = (pct: number) => {
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
};

const stepLabel = (depth: number) =>
  depth === 1 ? "1 step after" : `${depth} steps after`;

function Node({
  path,
  volume,
  percentage,
  highlighted,
  onClick,
}: {
  path: string;
  volume: number;
  percentage?: number;
  highlighted: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={path}
      className={
        "flex w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm transition-colors " +
        (highlighted
          ? "bg-indigo-600 text-white"
          : "bg-indigo-100 text-indigo-950 hover:bg-indigo-200")
      }
      style={{ height: NODE_PX }}
    >
      <span className="min-w-0 flex-1 truncate">{path}</span>
      <span className="flex shrink-0 flex-col items-end leading-tight">
        <span className="font-semibold">{formatVolume(volume)}</span>
        {percentage !== undefined && (
          <span className="text-[10px] opacity-70">
            {formatPercentage(percentage)}
          </span>
        )}
      </span>
    </button>
  );
}

function EventsBlock({
  path,
  items,
}: {
  path: string;
  items: { name: string; volume: number }[];
}) {
  return (
    <div className="mt-4 space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
        <Zap size={12} />
        Events on <span className="truncate" title={path}>{path}</span>
      </p>
      {items.map((event) => (
        <div
          key={event.name}
          className="flex items-center justify-between gap-2 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-950"
          title={event.name}
        >
          <span className="min-w-0 flex-1 truncate">{event.name}</span>
          <span className="shrink-0 font-semibold">
            {formatVolume(event.volume)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex items-start gap-10">
      {[4, 2, 1].map((rows, col) => (
        <div key={col} className={`${COLUMN_WIDTH} shrink-0 space-y-2`}>
          <div className="h-4 w-24 animate-pulse rounded bg-black/5 dark:bg-white/10" />
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-md bg-black/5 dark:bg-white/10"
              style={{ height: NODE_PX }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function JourneyFlow({
  data,
  isLoading,
  isError,
  onSelectPath,
}: {
  data?: JourneysResponse;
  isLoading: boolean;
  isError: boolean;
  onSelectPath: (path: string) => void;
}) {
  if (isLoading && !data) return <Skeleton />;

  if (isError) {
    return (
      <p className="py-16 text-center text-sm text-danger">
        Could not load journeys. Try a different period or reload the page.
      </p>
    );
  }

  if (!data || !data.startingPoint || data.startingPoints.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="font-medium">No journeys found</p>
        <p className="mt-1 text-sm text-text-muted">
          Once visitors navigate between pages, their journeys will appear
          here.
        </p>
      </div>
    );
  }

  const root = data.startingPoint;
  const followSteps = data.steps.filter((step) => step.depth > 0);

  // The root can sit outside the top-10 list when it was reached by clicking
  // a deep node; show it in the starting column anyway.
  const startingPoints = data.startingPoints.some((p) => p.path === root.path)
    ? data.startingPoints
    : [{ path: root.path, volume: root.volume }, ...data.startingPoints];

  // Connector from the previous column's top node: both columns share the
  // same header height, so the line sits at the top node's vertical centre.
  const connectorTop = HEADER_PX + NODE_PX / 2;

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex min-w-max items-start gap-10">
        <div className={`${COLUMN_WIDTH} shrink-0`}>
          <div
            className="flex items-end justify-between text-xs font-medium text-text-secondary"
            style={{ height: HEADER_PX, paddingBottom: 6 }}
          >
            <span>Starting point</span>
            <span>volume</span>
          </div>
          <div className="space-y-2">
            {startingPoints.map((point) => (
              <Node
                key={point.path}
                path={point.path}
                volume={point.volume}
                percentage={point.path === root.path ? 100 : undefined}
                highlighted={point.path === root.path}
                onClick={() => onSelectPath(point.path)}
              />
            ))}
          </div>
        </div>

        {followSteps.map((step) => (
          <div key={step.depth} className={`relative ${COLUMN_WIDTH} shrink-0`}>
            <div
              aria-hidden
              className="absolute -left-10 w-10 border-t-2 border-indigo-300"
              style={{ top: connectorTop }}
            />
            <div
              className="flex items-end text-xs font-medium text-text-secondary"
              style={{ height: HEADER_PX, paddingBottom: 6 }}
            >
              {stepLabel(step.depth)}
            </div>
            <div className="space-y-2">
              {step.paths.map((node, index) => (
                <Node
                  key={node.path}
                  path={node.path}
                  volume={node.volume}
                  percentage={node.percentage}
                  highlighted={index === 0}
                  onClick={() => onSelectPath(node.path)}
                />
              ))}
            </div>
            {step.events && (
              <EventsBlock path={step.events.path} items={step.events.items} />
            )}
          </div>
        ))}

        {followSteps.length === 0 && (
          <div className={`${COLUMN_WIDTH} shrink-0 pt-7`}>
            <p
              className="flex items-center rounded-md border border-dashed border-border px-3 text-sm text-text-muted"
              style={{ height: NODE_PX }}
            >
              No further pageviews after {root.path}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
