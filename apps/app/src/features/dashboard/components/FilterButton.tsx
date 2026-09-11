import { useEffect, useRef, useState } from "react";
import { ListFilter } from "lucide-react";

import {
  FILTER_LABELS,
  OPERATOR_LABELS,
  useFilters,
  type FilterKey,
  type FilterOperator,
} from "../filters";

/**
 * Geo filters expect internal values (ISO codes, exact region names), so
 * manual entry only offers the dimensions where typing a value makes sense;
 * geography is filtered by clicking its card's rows instead.
 */
const MANUAL_KEYS = (Object.keys(FILTER_LABELS) as FilterKey[]).filter(
  (key) => !["country", "region", "city"].includes(key),
);

/** "Filter" header button: pick a dimension, type a value, apply. */
export default function FilterButton() {
  const { setFilter } = useFilters();

  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<FilterKey>("page");
  const [op, setOp] = useState<FilterOperator>("is");
  const [value, setValue] = useState("");

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const apply = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setFilter(key, trimmed, op);
    setValue("");
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition-colors duration-150 hover:border-border-strong hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <ListFilter size={15} className="text-text-muted" />
        <span>Filter</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Add filter"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          className="absolute right-0 z-50 mt-1.5 w-72 space-y-2.5 rounded-lg border border-border bg-surface p-3 shadow-lg"
        >
          <label className="block text-xs text-text-muted">
            Dimension
            <select
              value={key}
              onChange={(e) => setKey(e.target.value as FilterKey)}
              className="mt-0.5 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-primary"
            >
              {MANUAL_KEYS.map((k) => (
                <option key={k} value={k}>
                  {FILTER_LABELS[k]}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-text-muted">
            Condition
            <select
              value={op}
              onChange={(e) => setOp(e.target.value as FilterOperator)}
              className="mt-0.5 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-primary"
            >
              {(Object.keys(OPERATOR_LABELS) as FilterOperator[]).map((o) => (
                <option key={o} value={o}>
                  {OPERATOR_LABELS[o]}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-text-muted">
            Value
            <input
              ref={inputRef}
              type="text"
              value={value}
              placeholder={
                op === "contains" || op === "not_contains"
                  ? "Text to look for"
                  : key === "page"
                    ? "/pricing"
                    : key === "goal"
                      ? "Goal name"
                      : "Exact value"
              }
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply();
              }}
              className="mt-0.5 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-primary"
            />
          </label>

          <p className="text-xs text-text-muted">
            "is" and "is not" match the labels shown in the cards, e.g. "Chrome"
            or "Direct"; "contains" ignores case. Clicking any card row applies
            an "is" filter.
          </p>

          <button
            type="button"
            onClick={apply}
            disabled={!value.trim()}
            className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Apply filter
          </button>
        </div>
      )}
    </div>
  );
}
