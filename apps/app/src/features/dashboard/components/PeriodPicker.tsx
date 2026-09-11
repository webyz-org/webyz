import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Calendar, ChevronDown } from "lucide-react";

import { PERIOD_MENU, periodLabel } from "../../../config/periods";
import type { PeriodRange } from "../../../shared/hooks/usePeriod";

/** Today as YYYY-MM-DD in the browser's zone, for the date input defaults. */
const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.tagName === "INPUT" ||
    el.tagName === "SELECT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable);

/**
 * The reporting-period menu: grouped presets with single-key shortcuts
 * (pressed anywhere on the page outside a form field), a custom date range,
 * and a Realtime shortcut that navigates to the live view when the picker is
 * on a site page. Custom ranges surface as period=custom&from&to.
 */
export default function PeriodPicker({
  value,
  from,
  to,
  onChange,
}: {
  value: string;
  from?: string;
  to?: string;
  onChange: (period: string, range?: PeriodRange) => void;
}) {
  const { domain } = useParams<{ domain?: string }>();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from ?? todayIso());
  const [draftTo, setDraftTo] = useState(to ?? todayIso());
  const wrapRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setCustomOpen(false);
  };

  const select = (period: string) => {
    if (period === "realtime") {
      if (domain) navigate(`/sites/${domain}/realtime`);
      close();
      return;
    }
    if (period === "custom") {
      setDraftFrom(from ?? todayIso());
      setDraftTo(to ?? todayIso());
      setOpen(true);
      setCustomOpen(true);
      return;
    }
    onChange(period);
    close();
  };

  const applyCustom = () => {
    if (!draftFrom || !draftTo) return;
    // Swap instead of rejecting: the intent is unambiguous.
    const [lo, hi] =
      draftFrom <= draftTo ? [draftFrom, draftTo] : [draftTo, draftFrom];
    onChange("custom", { from: lo, to: hi });
    close();
  };

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Plausible-style single-key shortcuts, ignored while typing in a field.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === "Escape") {
        close();
        return;
      }
      const key = e.key.toUpperCase();
      for (const group of PERIOD_MENU) {
        const item = group.find((i) => i.key === key);
        if (item && (item.value !== "realtime" || domain)) {
          e.preventDefault();
          select(item.value);
          return;
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // select's identity changes every render (it closes over onChange, which
    // pages recreate); re-subscribing is cheap and avoids stale URL params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, from, to, onChange]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition-colors duration-150 hover:border-border-strong hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Calendar size={15} className="text-text-muted" />
        <span>{periodLabel(value, from, to)}</span>
        <ChevronDown size={14} className="text-text-muted" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Reporting period"
          className="absolute right-0 z-50 mt-1.5 w-60 rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          {PERIOD_MENU.map((group, gi) => (
            <div
              key={gi}
              className={gi > 0 ? "mt-1.5 border-t border-border pt-1.5" : ""}
            >
              {group.map((item) => {
                if (item.value === "realtime" && !domain) return null;
                const active = item.value === value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="menuitem"
                    onClick={() => select(item.value)}
                    className={
                      "flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[13px] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] " +
                      (active ? "font-medium text-brand-ink" : "")
                    }
                  >
                    {item.label}
                    <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted">
                      {item.key}
                    </kbd>
                  </button>
                );
              })}
            </div>
          ))}

          {customOpen && (
            <div className="mt-1.5 space-y-2 border-t border-border px-3.5 pt-2.5 pb-1.5">
              <label className="block text-xs text-text-muted">
                From
                <input
                  type="date"
                  value={draftFrom}
                  max={todayIso()}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  className="mt-0.5 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-primary"
                />
              </label>
              <label className="block text-xs text-text-muted">
                To
                <input
                  type="date"
                  value={draftTo}
                  max={todayIso()}
                  onChange={(e) => setDraftTo(e.target.value)}
                  className="mt-0.5 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-primary"
                />
              </label>
              <button
                type="button"
                onClick={applyCustom}
                disabled={!draftFrom || !draftTo}
                className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Apply range
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
