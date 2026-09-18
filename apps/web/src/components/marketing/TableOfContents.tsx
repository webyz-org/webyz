"use client";

import { useEffect, useState } from "react";

export type Heading = { id: string; text: string };

/**
 * The reading position, drawn on the section list beside a post.
 *
 * It reads heading positions on scroll rather than using an
 * IntersectionObserver: the question here is not "is this heading visible" but
 * "which heading did I last pass", and the observer answers the first one,
 * which leaves nothing marked whenever a section is longer than the viewport
 * and marks two at once on a short one. Reading rects is the direct answer.
 *
 * The work is one `getBoundingClientRect` per heading over a handful of
 * headings, reading a layout that has already settled, so it runs straight
 * from the scroll handler rather than being batched into an animation frame:
 * at this size the batching saved nothing measurable and only added a second
 * thing that has to fire for the mark to move.
 *
 * The listeners are passive, so none of this can delay a scroll.
 */

/** Where a heading counts as reached, matching the `scroll-mt-24` on each one. */
const OFFSET = 140;

export default function TableOfContents({ headings, label = "On this page" }: { headings: Heading[]; label?: string }) {
  const [active, setActive] = useState<string | null>(headings[0]?.id ?? null);

  useEffect(() => {
    if (headings.length === 0) return;

    const measure = () => {
      // At the end of the document the last section may be too short to ever
      // reach the offset, so nothing below it would light up. Give it the mark.
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) {
        setActive(headings[headings.length - 1].id);
        return;
      }

      let current = headings[0].id;
      for (const heading of headings) {
        const element = document.getElementById(heading.id);
        if (!element) continue;
        if (element.getBoundingClientRect().top - OFFSET <= 0) current = heading.id;
        else break;
      }
      setActive(current);
    };

    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav aria-label={label}>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      {/* No gap between the items: each one carries its own left border, and
          together they draw the single continuous rail the marker slides down. */}
      <ul className="mt-3 text-[13.5px]">
        {headings.map((heading) => {
          const current = heading.id === active;
          return (
            <li key={heading.id}>
              <a
                href={`#${heading.id}`}
                aria-current={current ? "location" : undefined}
                className={
                  "block border-l-2 py-1.5 pl-4 transition-colors duration-150 " +
                  (current
                    ? "border-brand font-medium text-ink"
                    : "border-border text-text-secondary hover:border-border-strong hover:text-ink")
                }
              >
                {heading.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
