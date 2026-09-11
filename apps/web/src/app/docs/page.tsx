import type { Metadata } from "next";
import Link from "next/link";

import SiteHeader from "../../components/marketing/SiteHeader";
import SiteFooter from "../../components/marketing/SiteFooter";
import { Ico } from "../../components/marketing/ui";
import { GITHUB_URL } from "../../config/site";
import { GUIDES } from "../../lib/docs";

export const metadata: Metadata = {
  title: "Documentation - Webyz",
  description: "Self-hosting, configuration, the tracker script, the HTTP API, development and architecture guides for Webyz.",
};

export default function DocsIndexPage() {
  return (
    <>
      <SiteHeader />
      <main className="container py-16 sm:py-20">
        <div className="max-w-[44rem]">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Documentation</p>
          <h1 className="mt-3 text-[34px] font-bold leading-[1.1] tracking-tight text-ink sm:text-[40px]">
            Run it, install it, read from it.
          </h1>
          <p className="mt-4 text-[16px] leading-relaxed text-text-secondary">
            Six guides, kept in the repository next to the code they describe. Start with self-hosting if you are
            running your own copy, or with the tracker if you are installing on a site.
          </p>
        </div>

        <ol className="mt-12 grid gap-4 sm:grid-cols-2">
          {GUIDES.map((g) => (
            <li key={g.slug}>
              <Link
                href={`/docs/${g.slug}`}
                className="group flex h-full flex-col rounded-xl border border-border bg-surface p-6 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-[17px] font-semibold text-ink">{g.title}</span>
                  <Ico name="arrow" className="h-4 w-4 text-muted transition-colors group-hover:text-brand-ink" />
                </span>
                <span className="mt-2 text-[14.5px] leading-relaxed text-text-secondary">{g.blurb}</span>
              </Link>
            </li>
          ))}
        </ol>

        <p className="mt-10 text-[14px] text-muted">
          These pages are rendered from the Markdown in the repository&apos;s{" "}
          <a href={`${GITHUB_URL}/tree/main/docs`} className="underline hover:text-ink">
            docs folder
          </a>
          . Corrections are welcome as pull requests.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
