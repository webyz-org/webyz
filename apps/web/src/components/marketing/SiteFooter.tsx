import Link from "next/link";
import Image from "next/image";

import { API_URL, LOGIN_URL, SIGNUP_URL } from "../../config/site";
import { LEGAL } from "../../lib/legal";
import { Ico } from "./ui";

// The same two attributes the dashboard's install screen emits: the script is
// served by the API, not the app, and data-endpoint is required (the tracker
// sends nothing without it). Built from the configured API URL so the snippet
// shown here can never point at a host that does not serve it.
const SNIPPET = `<script defer src="${API_URL}/js/script.js"
  data-site-id="YOUR_SITE_ID"
  data-endpoint="${API_URL}/api/v1/track"></script>`;

type FootLink = { label: string; href?: string };

const COLUMNS: { title: string; links: FootLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Overview", href: "/#overview" },
      { label: "Pages", href: "/#overview" },
      { label: "Realtime", href: "/#who" },
      { label: "Journeys", href: "/#privacy" },
      { label: "Goals", href: "/#privacy" },
      { label: "Pricing", href: "/pricing" },
      { label: "Documentation", href: "/docs" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Privacy policy", href: "/privacy" },
      { label: "Terms of service", href: "/terms" },
      { label: "Refunds and cancellation", href: "/refunds" },
      { label: "Contact", href: `mailto:${LEGAL.contactEmail}` },
    ],
  },
  {
    title: "Account",
    links: [{ label: "Log in", href: LOGIN_URL }, { label: "Start free", href: SIGNUP_URL }],
  },
];

// Verified against the tracker: no cookies or browser storage, Do Not Track
// honoured by default, IP used only for the geo lookup and never stored, stack
// runs on your own servers.
const TRUST = ["No cookies, no browser storage", "Do Not Track honoured", "IP address never stored", "Self-hostable stack"];

/** The reference's slanted dark footer: tagline beside the logo, divided columns, trust list. */
export default function SiteFooter() {
  return (
    <footer className="slant-footer -mt-16 bg-night pt-36 text-white/75 lg:pt-44">
      <div className="container">
        <div className="grid gap-10 lg:grid-cols-12">
          <Link href="/" className="flex items-start gap-2 lg:col-span-3">
            <Image src="/images/logo.png" alt="" width={30} height={30} />
            <span className="text-[20px] font-bold tracking-tight text-white">webyz</span>
          </Link>
          <p className="max-w-2xl text-[34px] font-bold leading-[1.1] tracking-tight text-white sm:text-[42px] lg:col-span-9">
            <span className="hand text-brand" style={{ fontSize: "1.15em" }}>Privacy-first</span> analytics for
            <br />
            a new generation of websites.
          </p>
        </div>

        <div className="mt-20 grid gap-10 md:grid-cols-3 lg:ml-[25%]">
          {COLUMNS.map((column, i) => (
            <div key={column.title} className={i > 0 ? "md:border-l md:border-white/15 md:pl-10" : ""}>
              <h3 className="text-[17px] font-bold text-white">{column.title}</h3>
              <ul className="mt-4 space-y-2.5 text-[14px]">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {!link.href ? (
                      <span className="text-white/40">
                        {link.label} <span className="text-[12px]">(Coming soon)</span>
                      </span>
                    ) : link.href.startsWith("/") ? (
                      <Link href={link.href} className="transition-colors hover:text-white">{link.label}</Link>
                    ) : (
                      <a href={link.href} className="transition-colors hover:text-white">{link.label}</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-24 grid gap-12 border-t border-white/15 pt-12 lg:grid-cols-2 lg:gap-24">
          <div>
            <p className="text-[15px] text-white/80">We respect your visitors&apos; privacy.</p>
            <div className="mt-6 flex items-start gap-5">
              <span className="flex h-16 w-14 shrink-0 items-center justify-center rounded-[40%_40%_50%_50%] border-2 border-brand bg-brand/20 text-brand" aria-hidden>
                <Ico name="check" className="h-6 w-6" />
              </span>
              <ul className="space-y-2.5">
                {TRUST.map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-[14.5px] text-white/85">
                    <Ico name="check" className="h-4 w-4 text-brand" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {/* min-w-0: a grid item's default min-width is auto, so the long
              script line would widen the column and the page instead of
              scrolling inside the code block on narrow screens. */}
          <div id="install" className="min-w-0 scroll-mt-24 border-t border-white/15 pt-8 lg:border-t-0 lg:pt-0">
            <p className="text-[15px] leading-relaxed text-white/80">
              Installing takes one line. Paste it before the closing body tag of any site, framework or CMS.
            </p>
            <pre className="mt-5 max-w-full overflow-x-auto rounded-lg border border-white/15 bg-white/5 p-4 font-mono text-[12.5px] leading-relaxed text-white/90">
              <code>{SNIPPET}</code>
            </pre>
            <p className="mt-3 text-[12.5px] text-white/50">
              Under 4 KB gzipped. Loads with defer, never blocks the page. Your site ID is on the install screen after
              you add a website.
            </p>
          </div>
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-white/15 py-6 text-[13px] text-white/50">
          <span>&copy; {new Date().getFullYear()} Webyz. Source code under AGPL-3.0.</span>
          <span className="flex items-center gap-3">
            <Link href="/pricing" className="hover:text-white">Pricing</Link>
            <span aria-hidden>|</span>
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <span aria-hidden>|</span>
            <Link href="/terms" className="hover:text-white">Terms</Link>
            <span aria-hidden>|</span>
            <a href={LOGIN_URL} className="hover:text-white">Log in</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
