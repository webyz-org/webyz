import type { ReactNode } from "react";
import Link from "next/link";

import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";
import { LEGAL } from "../../lib/legal";

/**
 * Frame for the privacy policy and terms: a narrow reading column with a
 * table of contents, and a draft notice until `LEGAL.reviewed` is true so an
 * unreviewed page can never pass for a final one.
 */
export default function LegalPage({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: ReactNode;
  sections: { id: string; title: string; body: ReactNode }[];
}) {
  const updated = new Date(LEGAL.lastUpdated).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <SiteHeader />
      <main className="container py-16 sm:py-20">
        <div className="grid gap-12 lg:grid-cols-12">
          <aside className="lg:col-span-3">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Legal</p>
            <nav aria-label="On this page" className="mt-3 lg:sticky lg:top-24">
              <ul className="space-y-1.5 text-[13.5px]">
                <li>
                  <Link href="/privacy" className="text-text-secondary hover:text-ink">
                    Privacy policy
                  </Link>
                </li>
                <li>
                  <Link href="/terms" className="text-text-secondary hover:text-ink">
                    Terms of service
                  </Link>
                </li>
                <li>
                  <Link href="/refunds" className="text-text-secondary hover:text-ink">
                    Refunds and cancellation
                  </Link>
                </li>
              </ul>
              <ul className="mt-6 hidden space-y-1.5 border-l border-border pl-4 text-[13px] lg:block">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="text-muted hover:text-ink">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          <article className="max-w-[44rem] lg:col-span-8 lg:col-start-5">
            <h1 className="text-[34px] font-bold leading-[1.1] tracking-tight text-ink sm:text-[40px]">{title}</h1>
            <p className="mt-3 text-[13.5px] text-muted">Last updated {updated}</p>

            {!LEGAL.reviewed && (
              <p className="mt-6 rounded-lg border border-dashed border-border bg-surface px-4 py-3 text-[13.5px] text-text-secondary">
                Draft. This page describes how Webyz works today and has not yet been reviewed by a lawyer. Any value
                still in square brackets is to be filled in.
              </p>
            )}

            <div className="legal mt-8 space-y-4 text-[15px] leading-relaxed text-text-secondary">{intro}</div>

            {sections.map((s) => (
              <section key={s.id} id={s.id} className="legal mt-12 scroll-mt-24">
                <h2 className="text-[20px] font-bold tracking-tight text-ink">{s.title}</h2>
                <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-text-secondary">{s.body}</div>
              </section>
            ))}
          </article>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
