import type { Metadata } from "next";

import SiteHeader from "../../components/marketing/SiteHeader";
import SiteFooter from "../../components/marketing/SiteFooter";
import { ButtonLink, Eyebrow, Ico } from "../../components/marketing/ui";
import { GITHUB_URL, SIGNUP_URL } from "../../config/site";
import { KIND_LABEL, RELEASES, formatReleaseDate, sortItems, type ChangeKind } from "../../lib/changelog";

export const metadata: Metadata = {
  title: "Changelog - Webyz",
  description: "Every release to Webyz, newest first: what was added, what changed and what was fixed.",
  alternates: {
    canonical: "/changelog",
    types: { "application/rss+xml": "/changelog/rss.xml" },
  },
  openGraph: {
    type: "website",
    url: "/changelog",
    title: "Changelog - Webyz",
    description: "Every release to Webyz, newest first: what was added, what changed and what was fixed.",
  },
};

/**
 * The tag beside each line. Colour carries the meaning at a glance, and the
 * word carries it for anyone who cannot use the colour, so both are always
 * present. Each pair is a tint with ink dark enough to read on it.
 */
const KIND_CHIP: Record<ChangeKind, string> = {
  new: "bg-primary-soft text-brand-ink",
  improved: "bg-surface-2 text-text-secondary",
  fixed: "bg-success-soft text-success-ink",
};

export default function ChangelogPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden">
          <div className="hero-bg absolute inset-0 h-[420px]" aria-hidden />
          <div className="container relative py-16 sm:py-20">
            <div className="max-w-[46rem]">
              <Eyebrow>Changelog</Eyebrow>
              <h1 className="display mt-4 text-[38px] sm:text-[46px] lg:text-[52px]">
                What shipped,
                <br />
                and when.
              </h1>
              <p className="mt-5 max-w-[42rem] text-[17px] leading-relaxed text-text-secondary sm:text-[18px]">
                Every release to Webyz, newest first. New capabilities, changes to what was already there, and the
                bugs we put right, in the same words we would use to explain them to you in person.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-2">
                <ButtonLink href="/changelog/rss.xml" tone="outline">
                  <Ico name="rss" className="h-4 w-4" />
                  Subscribe by RSS
                </ButtonLink>
                <ButtonLink href={`${GITHUB_URL}/blob/main/CHANGELOG.md`} tone="ghost">
                  Full changelog on GitHub
                  <Ico name="arrow" className="h-4 w-4" />
                </ButtonLink>
              </div>
            </div>
          </div>
        </section>

        <div className="container pb-8">
          <ol>
            {RELEASES.map((release) => (
              <li key={release.slug} id={release.slug} className="scroll-mt-24">
                <div className="grid gap-4 lg:grid-cols-12 lg:gap-10">
                  {/* The date rail. It sticks while its own entry is being read, so a
                      long entry never loses the date it belongs to. */}
                  <div className="lg:col-span-3">
                    <div className="flex items-center gap-3 lg:sticky lg:top-24 lg:block">
                      <time dateTime={release.date} className="block text-[14px] font-semibold text-ink">
                        {formatReleaseDate(release.date)}
                      </time>
                      {release.tag && (
                        <span className="inline-block rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-ink lg:mt-2">
                          {release.tag}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* The spine: one hairline down the page with a marker per release. */}
                  <article className="relative border-l border-border pb-14 pl-6 sm:pl-8 lg:col-span-9">
                    <span
                      className="absolute -left-[5px] top-[9px] h-2.5 w-2.5 rounded-full border-2 border-surface bg-brand"
                      aria-hidden
                    />

                    <h2 className="group flex items-start gap-2 text-[22px] font-bold leading-snug tracking-tight text-ink sm:text-[25px]">
                      <a href={`#${release.slug}`} className="rounded outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50">
                        {release.title}
                        <Ico
                          name="link"
                          className="ml-2 inline h-4 w-4 shrink-0 align-middle text-muted opacity-0 transition-opacity group-hover:opacity-100"
                        />
                      </a>
                    </h2>

                    {release.summary && (
                      <p className="mt-3 max-w-[46rem] text-[15.5px] leading-relaxed text-text-secondary">
                        {release.summary}
                      </p>
                    )}

                    <ul className="mt-6 space-y-3.5">
                      {sortItems(release.items).map((item) => (
                        <li key={item.text} className="flex flex-col gap-1.5 sm:flex-row sm:gap-4">
                          <span
                            className={
                              "inline-flex h-[22px] w-max shrink-0 items-center rounded px-2 text-[11px] font-semibold uppercase tracking-wide sm:w-[76px] sm:justify-center " +
                              KIND_CHIP[item.kind]
                            }
                          >
                            {KIND_LABEL[item.kind]}
                          </span>
                          <span className="max-w-[46rem] text-[15px] leading-relaxed text-text-secondary">
                            {item.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </article>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <section className="container pb-20 sm:pb-28">
          <div className="rounded-2xl border border-border bg-surface-2 p-8 sm:p-10">
            <div className="grid gap-6 lg:grid-cols-12 lg:items-center">
              <div className="lg:col-span-8">
                <h2 className="text-[22px] font-bold tracking-tight text-ink">Follow along</h2>
                <p className="mt-2 max-w-[42rem] text-[15.5px] leading-relaxed text-text-secondary">
                  Releases land here first. The feed carries the same entries, and the repository carries the
                  commit behind every one of them, including the parts that only matter if you self-host.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 lg:col-span-4 lg:justify-end">
                <ButtonLink href="/changelog/rss.xml" tone="outline">
                  <Ico name="rss" className="h-4 w-4" />
                  RSS
                </ButtonLink>
                <ButtonLink href={SIGNUP_URL} tone="blue">
                  Start free
                </ButtonLink>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
