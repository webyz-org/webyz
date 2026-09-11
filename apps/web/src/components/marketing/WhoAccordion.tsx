"use client";

import Link from "next/link";
import { useState } from "react";

import { Ico } from "./ui";

export type Audience = { title: string; text: string };

/**
 * Exactly one card is open at all times.
 *
 * A plain <details name> group gets the "only one at a time" part, but the
 * open card can still be collapsed, and then the blue block shrinks. Holding
 * the index here means clicking the open card is a no-op, so the block keeps
 * one height however the reader moves through it.
 */
export default function WhoAccordion({ items }: { items: Audience[] }) {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const open = i === openIndex;
        return (
          <div
            key={item.title}
            className={
              "overflow-hidden rounded-xl bg-surface text-ink transition-shadow duration-200 " +
              (open ? "shadow-[0_24px_40px_-24px_rgba(45,35,35,0.6)]" : "")
            }
          >
            <h3>
              <button
                type="button"
                onClick={() => setOpenIndex(i)}
                aria-expanded={open}
                aria-controls={`who-panel-${i}`}
                className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left text-[22px] font-bold tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50"
              >
                {item.title}
                <span
                  className={
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-ink text-ink transition-transform duration-200 " +
                    (open ? "rotate-45" : "")
                  }
                >
                  <Ico name="plus" className="h-3.5 w-3.5" />
                </span>
              </button>
            </h3>

            {open && (
              <div id={`who-panel-${i}`} className="px-6 pb-6">
                <p className="min-h-[4.5rem] text-[14px] leading-relaxed text-text-secondary">{item.text}</p>
                <Link
                  href="#overview"
                  className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-brand-ink transition-colors duration-150 hover:text-ink"
                >
                  Learn more <Ico name="chevron" className="h-3 w-3 -rotate-90" />
                </Link>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
