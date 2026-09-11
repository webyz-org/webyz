import { X } from "lucide-react";

import {
  FILTER_LABELS,
  OPERATOR_LABELS,
  useFilters,
  type FilterCondition,
  type FilterKey,
} from "../filters";
import { countryFlag, countryName, languageName } from "../../../shared/lib/format";

/**
 * Active drill-down filters as removable pills. Renders nothing while no
 * filter is applied, so it costs no space on the default dashboard.
 * `trailing` lets the page add controls that only make sense with filters on
 * (saving them as a segment).
 */
export default function FilterBar({ trailing }: { trailing?: React.ReactNode }) {
  const { filters, removeFilter, clearFilters } = useFilters();

  const entries = Object.entries(filters) as [FilterKey, FilterCondition][];
  if (!entries.length) return null;

  // Countries are filtered by ISO code and languages by tag; both read
  // better as names. Substring filters show the typed text as is.
  const displayValue = (key: FilterKey, { op, value }: FilterCondition) => {
    if (op === "contains" || op === "not_contains") return value;
    if (key === "country") return `${countryFlag(value)} ${countryName(value)}`;
    if (key === "language") return languageName(value);
    return value;
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
      {entries.map(([key, condition]) => (
        <span
          key={key}
          className="flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-border bg-surface pl-2.5 pr-1 text-[13px]"
        >
          <span className="shrink-0 text-text-muted">
            {FILTER_LABELS[key]} {OPERATOR_LABELS[condition.op]}
          </span>
          <span className="truncate font-medium">
            {displayValue(key, condition)}
          </span>
          <button
            type="button"
            onClick={() => removeFilter(key)}
            aria-label={`Remove ${FILTER_LABELS[key]} filter`}
            className="shrink-0 rounded-full p-0.5 text-text-muted hover:bg-black/5 dark:hover:bg-white/[0.07] hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </span>
      ))}

      {entries.length > 1 && (
        <button
          type="button"
          onClick={clearFilters}
          className="text-sm text-text-muted hover:text-text-primary hover:underline"
        >
          Clear all
        </button>
      )}

      {trailing}
    </div>
  );
}
