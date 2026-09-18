import type { Metadata } from "next";
import Link from "next/link";

import SiteHeader from "../../components/marketing/SiteHeader";
import SiteFooter from "../../components/marketing/SiteFooter";
import { ButtonLink, Eyebrow, Ico } from "../../components/marketing/ui";
import { SITE_URL } from "../../config/site";
import { getPosts, postMeta, type Post } from "../../lib/blog";

const TITLE = "Blog - Webyz";
const DESCRIPTION =
  "How privacy-first analytics actually works: what we measure, how we measure it, and what each decision costs.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/blog",
    types: { "application/rss+xml": "/blog/rss.xml" },
  },
  openGraph: { type: "website", url: "/blog", title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

function TagRow({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="mt-5 flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li
          key={tag}
          className="rounded-full border border-border px-2.5 py-0.5 text-[12px] font-medium text-muted"
        >
          {tag.replace(/-/g, " ")}
        </li>
      ))}
    </ul>
  );
}

/** The newest post, given the width to actually sell the read. */
function LeadCard({ post }: { post: Post }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group block rounded-2xl border border-border bg-surface p-7 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50 sm:p-10"
    >
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] font-medium uppercase tracking-[0.12em] text-muted">
        <span className="text-brand-ink">Latest</span>
        <span aria-hidden>/</span>
        <span className="tracking-normal normal-case text-[13px]">{postMeta(post)}</span>
      </p>
      <h2 className="display mt-4 max-w-[26ch] text-[28px] sm:text-[34px]">{post.title}</h2>
      <p className="mt-4 max-w-[62ch] text-[16px] leading-relaxed text-text-secondary">{post.description}</p>
      <TagRow tags={post.tags} />
      <p className="mt-7 flex items-center gap-2 text-[14px] font-medium text-brand-ink">
        Read it
        <Ico name="arrow" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </p>
    </Link>
  );
}

function PostCard({ post }: { post: Post }) {
  return (
    <article className="h-full">
      <Link
        href={`/blog/${post.slug}`}
        className="group flex h-full flex-col rounded-xl border border-border bg-surface p-6 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50"
      >
        <p className="text-[13px] text-muted">{postMeta(post)}</p>
        <h2 className="mt-3 text-[19px] font-bold leading-snug tracking-tight text-ink">{post.title}</h2>
        <p className="mt-2.5 text-[14.5px] leading-relaxed text-text-secondary">{post.description}</p>
        <TagRow tags={post.tags} />
        <span className="mt-auto flex items-center gap-2 pt-6 text-[14px] font-medium text-brand-ink">
          Read it
          <Ico name="arrow" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </article>
  );
}

export default async function BlogIndexPage() {
  const posts = await getPosts();
  const [lead, ...rest] = posts;

  // Schema.org for the index. The posts are listed with the same titles, dates
  // and URLs the page renders, so the markup and the page cannot disagree.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${SITE_URL}/blog`,
    name: "The Webyz blog",
    description: DESCRIPTION,
    url: `${SITE_URL}/blog`,
    publisher: { "@type": "Organization", name: "Webyz", url: SITE_URL },
    blogPost: posts.map((post) => ({
      "@type": "BlogPosting",
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      dateModified: post.updated ?? post.date,
      author: { "@type": "Organization", name: post.author },
      url: `${SITE_URL}/blog/${post.slug}`,
    })),
  };

  return (
    <>
      <SiteHeader />
      <main>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

        <section className="relative overflow-hidden">
          <div className="hero-bg absolute inset-0 h-[420px]" aria-hidden />
          <div className="container relative py-16 sm:py-20">
            <div className="max-w-[46rem]">
              <Eyebrow>Blog</Eyebrow>
              <h1 className="display mt-4 text-[38px] sm:text-[46px] lg:text-[52px]">
                How the numbers
                <br />
                are made.
              </h1>
              <p className="mt-5 max-w-[44rem] text-[17px] leading-relaxed text-text-secondary sm:text-[18px]">
                {DESCRIPTION} Written by the people who wrote the code, with the trade-offs left in.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-2">
                <ButtonLink href="/blog/rss.xml" tone="outline">
                  <Ico name="rss" className="h-4 w-4" />
                  Subscribe by RSS
                </ButtonLink>
                <ButtonLink href="/docs" tone="ghost">
                  Read the documentation
                  <Ico name="arrow" className="h-4 w-4" />
                </ButtonLink>
              </div>
            </div>
          </div>
        </section>

        <div className="container pb-20 sm:pb-28">
          {lead && <LeadCard post={lead} />}
          {rest.length > 0 && (
            <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {rest.map((post) => (
                <PostCard key={post.slug} post={post} />
              ))}
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
