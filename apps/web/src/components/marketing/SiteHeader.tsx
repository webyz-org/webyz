import Link from "next/link";
import Image from "next/image";

import { GITHUB_URL, LOGIN_URL, SIGNUP_URL } from "../../config/site";
import { ButtonLink, GithubMark, Ico } from "./ui";
import MenuAutoClose from "./MenuAutoClose";

export const PRODUCT_AREAS = [
  { href: "/#overview", label: "Overview", blurb: "Traffic, sources and stats on one page" },
  { href: "/#overview", label: "Pages", blurb: "Top, entry and exit pages" },
  { href: "/#who", label: "Realtime", blurb: "Who is on the site right now" },
  { href: "/#overview", label: "Search", blurb: "Filters and Google Search Console" },
  { href: "/#privacy", label: "Journeys", blurb: "Paths visitors take" },
  { href: "/#privacy", label: "Goals", blurb: "Conversions and funnels" },
];

const NAV = [
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/blog", label: "Blog" },
  { href: "/changelog", label: "Changelog" },
];

const linkCls = "flex h-9 items-center gap-1 rounded-lg px-3 text-[13.5px] font-medium text-text-secondary transition-colors hover:text-ink";

/** Reference header: small nav beside the logo, outlined Log in, filled Start free. */
export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 bg-page/90 backdrop-blur">
      <MenuAutoClose />
      <div className="container flex h-16 items-center justify-between gap-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50">
            <Image src="/images/logo.png" alt="" width={28} height={28} priority />
            <span className="text-[19px] font-bold tracking-tight text-ink">webyz</span>
            <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-ink">
              Beta
            </span>
          </Link>
          <nav className="hidden items-center lg:flex" aria-label="Primary">
            <details className="group relative">
              <summary className={linkCls}>
                Product
                <Ico name="chevron" className="h-3.5 w-3.5 text-muted transition-transform group-open:rotate-180" />
              </summary>
              <div className="absolute left-0 top-11 w-[420px] rounded-xl border border-border bg-surface p-2 shadow-[0_12px_32px_-16px_rgba(45,35,35,0.3)]">
                <ul className="grid grid-cols-2 gap-0.5">
                  {PRODUCT_AREAS.map((area) => (
                    <li key={area.label}>
                      <Link href={area.href} className="block rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2">
                        <span className="block text-sm font-medium text-ink">{area.label}</span>
                        <span className="mt-0.5 block text-[12.5px] text-muted">{area.blurb}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className={linkCls}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Webyz on GitHub"
            title="Webyz on GitHub"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition-colors duration-150 hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50"
          >
            <GithubMark className="h-[18px] w-[18px]" />
          </a>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <ButtonLink href={LOGIN_URL} tone="outline">
            Log in
          </ButtonLink>
          <ButtonLink href={SIGNUP_URL} tone="blue">
            Start free
          </ButtonLink>
        </div>

        <details className="group relative lg:hidden">
          <summary className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-ink" aria-label="Menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4.5 w-4.5 group-open:hidden" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="hidden h-4.5 w-4.5 group-open:block" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </summary>
          <div className="absolute right-0 top-11 w-72 rounded-xl border border-border bg-surface p-2 shadow-[0_12px_32px_-16px_rgba(45,35,35,0.3)]">
            <nav className="grid grid-cols-2" aria-label="Product">
              {PRODUCT_AREAS.map((area) => (
                <Link key={area.label} href={area.href} className="rounded-lg px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-2 hover:text-ink">
                  {area.label}
                </Link>
              ))}
            </nav>
            <nav className="mt-1 flex flex-col border-t border-border pt-1" aria-label="Primary">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="rounded-lg px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-2 hover:text-ink">
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-1 border-t border-border pt-1">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-2 hover:text-ink"
              >
                <GithubMark className="h-4 w-4" />
                GitHub
              </a>
            </div>
            <div className="mt-2 grid gap-2 border-t border-border pt-2">
              <ButtonLink href={LOGIN_URL} tone="outline" className="w-full">Log in</ButtonLink>
              <ButtonLink href={SIGNUP_URL} tone="blue" className="w-full">Start free</ButtonLink>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
