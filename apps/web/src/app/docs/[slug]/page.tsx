import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import SiteHeader from "../../../components/marketing/SiteHeader";
import SiteFooter from "../../../components/marketing/SiteFooter";
import { GITHUB_URL } from "../../../config/site";
import { GUIDES, extractHeadings, findGuide, readGuide, rewriteDocLink, slugifyHeading } from "../../../lib/docs";

export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const guide = findGuide(slug);
  return guide
    ? { title: `${guide.title} - Webyz docs`, description: guide.blurb }
    : { title: "Documentation - Webyz" };
}

const textOf = (node: React.ReactNode): string =>
  Array.isArray(node)
    ? node.map(textOf).join("")
    : typeof node === "string" || typeof node === "number"
      ? String(node)
      : node && typeof node === "object" && "props" in node
        ? textOf((node as { props: { children?: React.ReactNode } }).props.children)
        : "";

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = findGuide(slug);
  if (!guide) notFound();

  const markdown = await readGuide(guide);
  const headings = extractHeadings(markdown);
  const index = GUIDES.findIndex((g) => g.slug === guide.slug);
  const prev = GUIDES[index - 1];
  const next = GUIDES[index + 1];

  return (
    <>
      <SiteHeader />
      <main className="container py-16 sm:py-20">
        <div className="grid gap-12 lg:grid-cols-12">
          <aside className="lg:col-span-3">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">
              <Link href="/docs" className="hover:text-ink">
                Documentation
              </Link>
            </p>
            <nav aria-label="Guides" className="mt-3 lg:sticky lg:top-24">
              <ul className="space-y-1.5 text-[13.5px]">
                {GUIDES.map((g) => (
                  <li key={g.slug}>
                    <Link
                      href={`/docs/${g.slug}`}
                      aria-current={g.slug === guide.slug ? "page" : undefined}
                      className={g.slug === guide.slug ? "font-semibold text-ink" : "text-text-secondary hover:text-ink"}
                    >
                      {g.title}
                    </Link>
                  </li>
                ))}
              </ul>
              {headings.length > 1 && (
                <ul className="mt-6 hidden space-y-1.5 border-l border-border pl-4 text-[13px] lg:block">
                  {headings.map((h) => (
                    <li key={h.id}>
                      <a href={`#${h.id}`} className="text-muted hover:text-ink">
                        {h.text}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </nav>
          </aside>

          <article className="doc min-w-0 max-w-[46rem] lg:col-span-8 lg:col-start-5">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                // The file's own H1 is the page title; keep it as the H1.
                h1: ({ children }) => (
                  <h1 className="text-[34px] font-bold leading-[1.1] tracking-tight text-ink sm:text-[40px]">{children}</h1>
                ),
                h2: ({ children }) => {
                  const text = textOf(children);
                  return (
                    <h2 id={slugifyHeading(text)} className="scroll-mt-24">
                      {children}
                    </h2>
                  );
                },
                h3: ({ children }) => {
                  const text = textOf(children);
                  return (
                    <h3 id={slugifyHeading(text)} className="scroll-mt-24">
                      {children}
                    </h3>
                  );
                },
                a: ({ href, children }) => {
                  const target = rewriteDocLink(href ?? "");
                  const external = /^https?:\/\//.test(target);
                  return external ? (
                    <a href={target} rel="noopener">
                      {children}
                    </a>
                  ) : (
                    <Link href={target}>{children}</Link>
                  );
                },
                table: ({ children }) => (
                  <div className="doc-table">
                    <table>{children}</table>
                  </div>
                ),
              }}
            >
              {markdown}
            </Markdown>

            <footer className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-[14px]">
              <span>
                {prev && (
                  <Link href={`/docs/${prev.slug}`} className="text-text-secondary hover:text-ink">
                    ← {prev.title}
                  </Link>
                )}
              </span>
              <a href={`${GITHUB_URL}/blob/main/docs/${guide.file}`} className="text-muted hover:text-ink">
                Edit this page on GitHub
              </a>
              <span>
                {next && (
                  <Link href={`/docs/${next.slug}`} className="text-text-secondary hover:text-ink">
                    {next.title} →
                  </Link>
                )}
              </span>
            </footer>
          </article>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
