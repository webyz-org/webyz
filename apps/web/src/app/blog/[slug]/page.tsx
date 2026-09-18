import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import SiteHeader from "../../../components/marketing/SiteHeader";
import SiteFooter from "../../../components/marketing/SiteFooter";
import TableOfContents from "../../../components/marketing/TableOfContents";
import { ButtonLink, Ico } from "../../../components/marketing/ui";
import { SIGNUP_URL, SITE_URL } from "../../../config/site";
import { formatPostDate, getPost, getPosts, postMeta, relatedPosts } from "../../../lib/blog";
// The heading-id algorithm is shared with the rendered documentation on
// purpose: one anchor scheme across the site, so a link into a heading behaves
// the same wherever it points.
import { extractHeadings, slugifyHeading } from "../../../lib/docs";

/** Every post is known at build time, so an unknown slug is a 404, not a render. */
export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getPosts()).map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: "Blog - Webyz" };

  const url = `/blog/${post.slug}`;
  return {
    // A `seoTitle` is used exactly as written: a post that needs one has a
    // headline too long for a search result, and appending to it would undo
    // the point of setting it.
    title: post.seoTitle ?? `${post.title} - Webyz`,
    description: post.description,
    alternates: { canonical: url },
    authors: [{ name: post.author }],
    keywords: post.tags,
    openGraph: {
      type: "article",
      url,
      title: post.title,
      description: post.description,
      publishedTime: post.date,
      modifiedTime: post.updated ?? post.date,
      authors: [post.author],
      tags: post.tags,
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description },
  };
}

const textOf = (node: React.ReactNode): string =>
  Array.isArray(node)
    ? node.map(textOf).join("")
    : typeof node === "string" || typeof node === "number"
      ? String(node)
      : node && typeof node === "object" && "props" in node
        ? textOf((node as { props: { children?: React.ReactNode } }).props.children)
        : "";

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  const headings = extractHeadings(post.markdown);
  const related = await relatedPosts(post);
  const url = `${SITE_URL}/blog/${post.slug}`;

  // Two graphs, both describing what is on the page: the article itself, and
  // where it sits, which is what a search result renders as a breadcrumb.
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "@id": url,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      dateModified: post.updated ?? post.date,
      author: { "@type": "Organization", name: post.author, url: SITE_URL },
      publisher: { "@type": "Organization", name: "Webyz", url: SITE_URL },
      keywords: post.tags.join(", "),
      inLanguage: "en",
      isAccessibleForFree: true,
      ...(post.cover ? { image: [`${SITE_URL}${post.cover}`] } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_URL}/blog` },
        { "@type": "ListItem", position: 3, name: post.title, item: url },
      ],
    },
  ];

  return (
    <>
      <SiteHeader />
      <main className="container py-12 sm:py-16">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

        <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/" className="hover:text-ink">
                Home
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li>
              <Link href="/blog" className="hover:text-ink">
                Blog
              </Link>
            </li>
          </ol>
        </nav>

        <div className="mt-8 grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <header>
              <h1 className="display max-w-[22ch] text-[34px] sm:text-[42px] lg:text-[46px]">{post.title}</h1>
              <p className="mt-5 max-w-[60ch] text-[17px] leading-relaxed text-text-secondary">{post.description}</p>
              <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-muted">
                <span className="font-medium text-text-secondary">{post.author}</span>
                <span aria-hidden>/</span>
                <time dateTime={post.date}>{formatPostDate(post.date)}</time>
                <span aria-hidden>/</span>
                <span>{post.readingMinutes} min read</span>
              </p>
              {post.updated && (
                <p className="mt-2 text-[13px] text-muted">
                  Updated <time dateTime={post.updated}>{formatPostDate(post.updated)}</time>
                </p>
              )}
            </header>

            <hr className="mt-8 border-0 border-t border-border" />

            <article className="doc mt-8 min-w-0 max-w-[46rem]">
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h2: ({ children }) => (
                    <h2 id={slugifyHeading(textOf(children))} className="scroll-mt-24">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 id={slugifyHeading(textOf(children))} className="scroll-mt-24">
                      {children}
                    </h3>
                  ),
                  a: ({ href, children }) => {
                    const target = href ?? "";
                    return target.startsWith("/") ? (
                      <Link href={target}>{children}</Link>
                    ) : (
                      <a href={target} rel={target.startsWith("#") ? undefined : "noopener"}>
                        {children}
                      </a>
                    );
                  },
                  table: ({ children }) => (
                    <div className="doc-table">
                      <table>{children}</table>
                    </div>
                  ),
                }}
              >
                {post.markdown}
              </Markdown>
            </article>

            <div className="mt-12 rounded-2xl border border-border bg-surface-2 p-7 sm:p-8">
              <h2 className="text-[20px] font-bold tracking-tight text-ink">See it on your own site</h2>
              <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-text-secondary">
                One script tag, no cookie banner to wire up, and a 30 day trial that does not ask for a card.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <ButtonLink href={SIGNUP_URL} tone="blue">
                  Start free
                </ButtonLink>
                <ButtonLink href="/docs/tracker" tone="outline">
                  Read the tracker guide
                </ButtonLink>
              </div>
            </div>
          </div>

          {/* The sidebar is navigation, not content, so it comes after the
              article in the DOM and is hidden where it will not fit. */}
          <aside className="hidden lg:col-span-4 lg:block">
            <div className="sticky top-24">
              {headings.length > 1 && <TableOfContents headings={headings} />}
              {post.tags.length > 0 && (
                <ul className="mt-8 flex flex-wrap gap-1.5">
                  {post.tags.map((tag) => (
                    <li key={tag} className="rounded-full border border-border px-2.5 py-0.5 text-[12px] font-medium text-muted">
                      {tag.replace(/-/g, " ")}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>

        {related.length > 0 && (
          <section className="mt-16 border-t border-border pt-10">
            <h2 className="text-[22px] font-bold tracking-tight text-ink">Read next</h2>
            <ul className="mt-6 grid gap-6 md:grid-cols-3">
              {related.map((other) => (
                <li key={other.slug}>
                  <Link
                    href={`/blog/${other.slug}`}
                    className="group flex h-full flex-col rounded-xl border border-border bg-surface p-6 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50"
                  >
                    <span className="text-[13px] text-muted">{postMeta(other)}</span>
                    <span className="mt-3 text-[17px] font-semibold leading-snug text-ink">{other.title}</span>
                    <span className="mt-2 text-[14px] leading-relaxed text-text-secondary">{other.description}</span>
                    <span className="mt-auto flex items-center gap-2 pt-5 text-[14px] font-medium text-brand-ink">
                      Read it
                      <Ico name="arrow" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
