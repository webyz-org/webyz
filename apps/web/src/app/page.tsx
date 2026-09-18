import Link from "next/link";
import Image from "next/image";

import SiteHeader from "../components/marketing/SiteHeader";
import SiteFooter from "../components/marketing/SiteFooter";
import WhoAccordion from "../components/marketing/WhoAccordion";
import { BendArrow, CurlArrow, HookArrow, SmallArrow, Sparkle, Squiggle, Sticker } from "../components/marketing/Doodles";
import { ButtonLink, Ico, ProductFrame } from "../components/marketing/ui";
import { GITHUB_URL, SIGNUP_URL } from "../config/site";

/** Handwritten label with a small arrow, the reference's section opener. */
function Hand({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={"hand flex items-center gap-2 text-[22px] text-ink " + className}>
      {children}
      <SmallArrow className="h-5 w-9 text-ink" />
    </p>
  );
}

// Measured against apps/api/public/js/script.js on 18 Sep 2026: 6,484 bytes
// gzipped (5,533 brotli), no cookies or browser storage, 30 minute server-side
// session window. It said 3,843 bytes and "under 4 KB" from an earlier
// measurement; engagement reporting, outbound links, file downloads and 404
// tracking were added to the script after that and nobody re-measured. Re-run
// `gzip -c apps/api/public/js/script.js | wc -c` when you touch the tracker,
// and change this line with it.
const FIGURES: [string, string, string][] = [
  ["About", "6 KB", "script"],
  ["Sets", "0", "cookies"],
  ["Session", "30", "min"],
];

const VIEWS = [
  { icon: "layout", title: "Overview: the whole site on one page", open: true, text: "Visitors, visits, pageviews, views per visit, bounce rate and duration, each with a sparkline and its change against the previous period.", sub: "The graph ends in one sentence: how much traffic moved, the peak day, and the channel behind it." },
  { icon: "eye", title: "Pages, entry points and exits" },
  { icon: "globe", title: "Realtime visitors on a globe or map" },
  { icon: "route", title: "Journeys, goals and funnels" },
] as const;

const AUDIENCES = [
  { title: "Founders", text: "One page that answers whether the launch worked: visitors, where they came from, what they read and whether they signed up. Six stats above the fold, no configuration, no training." },
  { title: "Developers", text: "One script tag, 6.3 KB gzipped. Postgres, ClickHouse and Redis under the hood, self-hostable, and a plain data model you can query yourself." },
  { title: "Marketers", text: "Channels, sources and UTM breakdowns, filters that live in the URL so a view is a link, and goals that count the page visits and events that matter." },
  { title: "Teams", text: "Realtime on a shared screen, journeys to settle arguments about where people actually go, and public share links for anyone who needs a look without an account." },
];

// Quoted from apps/api/public/js/script.js: the payload a pageview actually
// sends. Nothing here is invented, which is the point of the section.
const TRACKER_SOURCE = `var payload = {
  t: "pageview",
  url: pageData.url,
  ref: state.currentRef,
  screen: utils.getScreen(),
  ts: utils.timestamp(),
};`;

const OWNERSHIP: [string, string, string][] = [
  ["01", "Open source", "AGPL-3.0 licensed. Inspect the code, understand how Webyz works, change it."],
  ["02", "Self-hostable", "Run Webyz on your own infrastructure when you want complete control."],
  ["03", "Your data", "Keep your analytics under your control instead of locking it into a closed platform."],
];

const STICKERS = [
  ["No cookies", "-left-4 top-8 -rotate-6", "light"],
  ["DNT honoured", "right-6 top-4 rotate-3", "dark"],
  ["No IP stored", "left-1/3 top-1/2 -rotate-3", "light"],
  ["Bots filtered", "-right-3 bottom-1/3 rotate-6", "light"],
  ["Opt-out built in", "left-6 -bottom-3 -rotate-2", "dark"],
] as const;

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="overflow-x-clip bg-page">
        {/* ---------------- Hero: text left, tilted collage right ---------------- */}
        <section className="relative">
          <div className="container grid gap-12 pt-10 lg:grid-cols-12 lg:items-center lg:pt-14">
            <div className="lg:col-span-5">
              <h1 className="text-[44px] font-bold leading-[1.02] tracking-tight text-ink sm:text-[56px] lg:text-[60px]">
                Privacy-first
                <br />
                analytics for
                <br />
                <span className="hand whitespace-nowrap text-brand" style={{ fontSize: "1.05em" }}>actionable insights</span>
              </h1>
              <p className="mt-8 max-w-sm text-[16px] leading-relaxed text-ink">
                Understand where your visitors come from, what they do, and what converts, without the complexity of
                traditional analytics. One script, one dashboard, your data.
              </p>
              <ButtonLink href={SIGNUP_URL} tone="blue" size="lg" className="mt-8 px-6">
                Start for free
              </ButtonLink>
            </div>

            {/* Collage: three tilted tiles of real UI, stickers and drawn arrows.
                The tiles are in the first viewport on every width, so they load
                eagerly with sizes matching their rendered width; lazy tiles here
                painted after everything else and cost Speed Index. Not
                `priority`: the fonts the h1 needs should win the first bytes. */}
            <div className="relative mx-auto h-[440px] w-full max-w-[560px] lg:col-span-7 lg:mx-0 lg:ml-auto">
              <Sparkle className="absolute left-[14%] top-[6%] h-5 w-5 rotate-12 text-ink" />
              <span className="absolute right-[6%] top-[42%] h-2.5 w-2.5 rounded-full bg-ink" aria-hidden />

              {/* Tile A: blue block, Overview stats */}
              <div className="absolute left-[38%] top-[2%] h-[150px] w-[300px] -rotate-6 rounded-sm bg-brand" aria-hidden />
              <div className="absolute left-[40%] top-[7%] w-[300px] rotate-3">
                <ProductFrame src="/images/st-overview.jpg" width={1000} height={290} alt="Overview stats with sparklines and change against the previous period" sizes="300px" eager className="rounded-lg" />
              </div>
              <Sticker tone="dark" className="left-[72%] top-[24%] rotate-3">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                Live
              </Sticker>
              <Sticker tone="blue" className="left-[30%] top-[16%] -rotate-6">+37%</Sticker>

              <CurlArrow className="absolute left-[46%] top-[44%] h-16 w-20 text-ink" />
              <BendArrow className="absolute left-[74%] top-[40%] h-20 w-16 text-ink" />

              {/* Tile B: light-blue block, live visitor list */}
              <div className="absolute left-[2%] top-[36%] h-[230px] w-[200px] rotate-6 rounded-sm bg-primary-soft" aria-hidden />
              <div className="absolute left-[6%] top-[40%] w-[175px] -rotate-3">
                <ProductFrame src="/images/st-live-list.jpg" width={352} height={555} alt="Live visitor list with country, page, browser and device" sizes="175px" eager className="rounded-lg" />
              </div>
              <Sticker tone="green" className="left-[-2%] top-[52%] -rotate-12">
                <Ico name="check" className="h-3 w-3" />
                9 online
              </Sticker>

              <HookArrow className="absolute left-[42%] top-[74%] h-12 w-24 text-ink" />

              {/* Tile C: cream block, globe */}
              <div className="absolute left-[64%] top-[64%] h-[130px] w-[150px] -rotate-3 rounded-sm bg-surface-2" aria-hidden />
              <div className="absolute left-[68%] top-[66%] w-[150px] rotate-6">
                <ProductFrame src="/images/st-realtime.jpg" width={864} height={555} alt="Realtime globe with visitor markers" sizes="150px" eager className="rounded-lg" />
              </div>
              <span className="absolute left-[90%] top-[62%] flex h-10 w-10 rotate-12 items-center justify-center rounded-full bg-brand shadow-[3px_3px_0_rgba(45,35,35,0.9)]" aria-hidden>
                <Image src="/images/logo.png" alt="" width={22} height={22} className="brightness-0 invert" />
              </span>
            </div>
          </div>

          {/* Ownership strip: the quiet band that closes the hero, in the slot
              the infrastructure logos used to fill. */}
          <div className="container pt-14 lg:pt-16">
            <Hand>Yours to inspect, run and own:</Hand>
            <div className="mt-4 grid gap-px overflow-hidden rounded-xl bg-border shadow-[0_12px_40px_-24px_rgba(45,35,35,0.35)] sm:grid-cols-3">
              {OWNERSHIP.map(([n, title, text]) => (
                <div key={n} className="bg-surface px-6 py-6">
                  <p className="font-mono text-[12px] text-muted">{n}</p>
                  <p className="mt-2 text-[15px] font-semibold text-ink">{title}</p>
                  <p className="mt-1.5 text-[13px] leading-snug text-muted">{text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* The reference's off-white slanted ground behind the first half. */}
          <div className="slant-tr absolute inset-x-0 -bottom-10 -z-10 h-72 bg-surface" aria-hidden />
        </section>

        {/* ---------------- Open source: the brand statement ---------------- */}
        <section id="open-source" className="scroll-mt-16 border-b border-border bg-surface py-24 lg:py-32">
          <div className="container grid gap-12 lg:grid-cols-12 lg:items-center lg:gap-8">
            <div className="lg:col-span-5">
              <Hand>Open source</Hand>
              <h2 className="mt-5 text-[32px] font-bold leading-[1.06] tracking-tight text-ink sm:text-[40px]">
                Analytics you can actually own.
              </h2>
              <p className="mt-5 max-w-md text-[16px] leading-relaxed text-ink">
                Webyz is open source and built for transparency. Inspect the code, run it yourself, and keep control of
                your analytics.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-3">
                <a
                  href={GITHUB_URL}
                  className="group inline-flex items-center gap-1.5 text-[15px] font-medium text-ink underline decoration-border-strong underline-offset-4 transition-colors duration-150 hover:decoration-ink"
                >
                  View on GitHub
                  <Ico name="arrow" className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
                </a>
                <a
                  href={GITHUB_URL}
                  className="group inline-flex items-center gap-1.5 text-[15px] font-medium text-text-secondary transition-colors duration-150 hover:text-ink"
                >
                  Self-host Webyz
                  <Ico name="arrow" className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
                </a>
              </div>
            </div>

            {/* A window of the product with the source it runs on behind it. */}
            <div className="lg:col-span-7">
              <div className="sm:hidden">
                <ProductFrame
                  src="/images/st-overview.jpg"
                  width={1000}
                  height={290}
                  alt="Webyz overview stats with sparklines and their change against the previous period"
                  sizes="640px"
                  className="rounded-xl"
                />
              </div>

              <div className="relative hidden h-[320px] sm:block">
                <figure className="absolute left-0 top-0 w-[68%] overflow-hidden rounded-xl border border-border bg-page shadow-[0_10px_30px_-20px_rgba(45,35,35,0.4)]">
                  <figcaption className="flex items-center gap-2.5 border-b border-border bg-surface px-4 py-2.5">
                    <span className="flex gap-1.5" aria-hidden>
                      <i className="h-2 w-2 rounded-full bg-border-strong" />
                      <i className="h-2 w-2 rounded-full bg-border-strong" />
                      <i className="h-2 w-2 rounded-full bg-border-strong" />
                    </span>
                    <span className="font-mono text-[11.5px] text-muted">public/js/script.js</span>
                  </figcaption>
                  <pre className="overflow-hidden p-4 font-mono text-[11px] leading-[1.75] text-text-secondary">
                    <code>{TRACKER_SOURCE}</code>
                  </pre>
                </figure>

                <div className="absolute bottom-0 right-0 w-[70%]">
                  <ProductFrame
                    src="/images/st-overview.jpg"
                    width={1000}
                    height={290}
                    alt="Webyz overview stats with sparklines and their change against the previous period"
                    sizes="560px"
                    className="rounded-xl shadow-[0_18px_50px_-28px_rgba(45,35,35,0.5)]"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- One platform: list with accent bar + slanted colour block with device ---------------- */}
        <section id="overview" className="scroll-mt-16 bg-surface pt-24 lg:pt-32">
          <div className="container">
            <Hand>One dashboard, multiple views.</Hand>
            <div className="mt-8 grid gap-12 lg:grid-cols-12 lg:items-start">
              <div className="lg:col-span-5">
                <h2 className="text-[32px] font-bold leading-[1.08] tracking-tight text-ink sm:text-[38px]">
                  Everything you need to understand your website, no matter what it&apos;s for.
                </h2>
                <ul className="mt-10 space-y-6">
                  {VIEWS.map((v) => (
                    <li key={v.title} className={"flex gap-4 " + ("open" in v && v.open ? "border-l-[3px] border-brand pl-5" : "pl-[23px]")}>
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-brand-ink">
                        <Ico name={v.icon} className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-[15px] font-bold text-ink">{v.title}</p>
                        {"text" in v && (
                          <>
                            <p className="mt-2 text-[14px] leading-relaxed text-text-secondary">{v.text}</p>
                            <p className="mt-3 flex gap-2 text-[13px] leading-relaxed text-muted">
                              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink" aria-hidden />
                              {v.sub}
                            </p>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="relative lg:col-span-7">
                <Squiggle className="absolute -left-10 top-6 hidden h-14 w-20 text-ink lg:block" />
                <div className="slant-block absolute -inset-y-8 left-[10%] -right-[20vw] -z-10 bg-brand" aria-hidden />
                <div className="relative ml-[6%] lg:-mr-[14vw]">
                  <ProductFrame
                    src="/images/dash-overview.jpg"
                    width={1440}
                    height={850}
                    alt="The Webyz dashboard for a demo site: six stats with sparklines and their change against the previous 28 days, the daily visitors graph, and the insight line beneath it"
                    className="rounded-2xl border-[10px] border-ink shadow-[0_30px_60px_-30px_rgba(45,35,35,0.6)]"
                  />
                </div>

                {/* A note in the page's own hand, filling the space the device
                    leaves under it and pointing back at the graph. */}
                <div className="ml-[10%] mt-6 flex items-start gap-3">
                  <BendArrow className="h-14 w-10 shrink-0 rotate-180 text-ink" />
                  <p className="hand mt-4 max-w-[15rem] text-[20px] leading-snug text-ink">
                    That spike on Aug 25? Organic Search.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Figures row: the reference's big numbers with handwritten words and arrows. */}
          <div className="container pt-28 lg:pt-32">
            <div className="border-b border-border pb-20">
            <div className="flex flex-col items-start gap-10 lg:flex-row lg:items-end lg:justify-between">
              {FIGURES.map(([label, value, word], i) => (
                <div key={label} className="flex items-end gap-6">
                  {i > 0 && <CurlArrow className="mb-6 hidden h-12 w-16 text-ink lg:block" />}
                  <div>
                    <p className="text-[13px] text-muted">{label}</p>
                    <p className="mt-1 flex items-baseline gap-3 text-[56px] font-bold leading-none tracking-tight text-ink sm:text-[64px]">
                      {value}
                      <span className="hand text-[44px] font-medium text-ink sm:text-[52px]">{word}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
            </div>
          </div>
        </section>

        {/* ---------------- Quote: tilted image left, large statement right ---------------- */}
        <section className="bg-surface py-24 lg:py-32">
          <div className="container grid gap-12 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-6">
              <div className="slant-photo rotate-[-2deg] overflow-hidden bg-surface-2 p-3">
                <Image
                  src="/images/dash-graph.jpg"
                  width={1240}
                  height={412}
                  alt="The daily visitors graph peaking on 25 August, with the insight line reading 37% more visitors than the previous 28 days"
                  sizes="(min-width: 1024px) 560px, 100vw"
                  className="w-full rounded-md"
                />
              </div>
            </div>
            <div className="lg:col-span-5 lg:col-start-8">
              <Hand>Hear what the dashboard has to say</Hand>
              <blockquote className="mt-6 border-l border-border pl-6">
                <p className="text-[26px] font-bold leading-[1.25] tracking-tight text-ink sm:text-[30px]">
                  &ldquo;37% more visitors than the previous 28 days. Traffic peaked on Aug 25, led by Organic Search.&rdquo;
                </p>
              </blockquote>
              <div className="mt-8 flex items-center justify-between gap-6">
                <span className="flex items-center gap-2">
                  <Image src="/images/logo.png" alt="" width={26} height={26} />
                  <span className="text-[15px] font-bold text-ink">Webyz Overview</span>
                </span>
                <span className="text-right text-[13px] leading-snug text-text-secondary">
                  <span className="block font-medium text-brand-ink">The insight line</span>
                  acme.example demo, last 28 days
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- Who is it for: slanted colour block, accordion cards + device ---------------- */}
        <section id="who" className="scroll-mt-16 bg-surface pb-16 pt-6">
          <div className="container">
            <div className="slant-block relative bg-brand px-8 pb-0 pt-16 text-white sm:px-14 lg:px-20 lg:pt-20">
              <p className="hand text-[22px] text-white">Who is it for?</p>
              <div className="mt-6 border-t border-white/60" />

              <div className="mt-12 grid gap-10 lg:grid-cols-12 lg:items-start">
                <div className="lg:col-span-5">
                  <WhoAccordion items={AUDIENCES} />
                </div>
                <div className="relative lg:col-span-7 lg:-mr-24 lg:mt-6">
                  <ProductFrame
                    src="/images/ui-realtime.jpg"
                    width={1232}
                    height={630}
                    alt="Realtime: globe with visitor markers and the live visitor list"
                    className="translate-y-10 rounded-2xl rounded-b-none border-[10px] border-b-0 border-ink"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- Privacy: narrow text with left rule, tinted block with stickers ---------------- */}
        <section id="privacy" className="scroll-mt-16 bg-surface py-24 lg:py-32">
          <div className="container grid gap-12 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-5">
              <Hand>Privacy, in practice</Hand>
              <div className="mt-8 border-l border-border pl-8">
                <h2 className="text-[30px] font-bold leading-[1.1] tracking-tight text-ink sm:text-[34px]">
                  Understand traffic.
                  <br />
                  Not people.
                </h2>
                <p className="mt-6 max-w-sm text-[14px] leading-relaxed text-text-secondary">
                  Your analytics should help you understand your website without turning analytics into unnecessary
                  surveillance. Webyz sets no cookies and stores nothing in the browser: visitors are counted with a
                  hash that rotates every day, so nobody can be followed from one day to the next. It honours Do Not
                  Track by default, lets visitors opt out, uses the IP only for a country lookup and never stores it,
                  and drops known bots before they reach your numbers. Whether you still need a consent banner depends
                  on your jurisdiction; read the{" "}
                  <Link href="/privacy" className="font-medium text-brand-ink hover:underline">
                    privacy policy
                  </Link>{" "}
                  for exactly what is collected.
                </p>
              </div>
            </div>
            <div className="relative lg:col-span-6 lg:col-start-7">
              <div className="rounded-sm bg-primary-soft p-8 sm:p-12">
                <ProductFrame src="/images/ui-journeys.jpg" width={1209} height={650} alt="Journeys: the pages visitors move to next, with events along the way" className="rounded-lg" />
              </div>
              {STICKERS.map(([label, pos, tone]) => (
                <Sticker key={label} tone={tone} className={pos + " text-[12px]"}>
                  {label}
                </Sticker>
              ))}
              <p className="absolute bottom-3 right-4 text-[12px] font-medium text-ink/60">
                Verified <span className="text-ink">against the code.</span>
              </p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
