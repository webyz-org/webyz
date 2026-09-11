import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

/* ---------- icons ---------- */

const ICONS = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  chevron: "m6 9 6 6 6-6",
  check: "M5 12.5 10 17.5 19 7",
  layout: "M4 5h16v14H4zM4 10h16M10 10v9",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c3 3 3 15 0 18M12 3c-3 3-3 15 0 18M3 12h18",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 17h5a4 4 0 0 0 0-8H11",
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6 6 18",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2",
} as const;

export function Ico({ name, className = "h-4 w-4" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

/* ---------- buttons: the dashboard's Button variants ---------- */

type Tone = "primary" | "outline" | "ghost" | "white" | "blue";

const TONES: Record<Tone, string> = {
  primary: "bg-ink text-white hover:bg-ink/90",
  outline: "border border-border-strong bg-surface text-ink hover:border-ink",
  ghost: "text-ink hover:bg-surface-2",
  white: "bg-white text-ink hover:bg-white/90",
  blue: "bg-brand text-white hover:bg-brand-ink",
};

export function ButtonLink({
  href,
  tone = "primary",
  size = "md",
  className = "",
  children,
}: {
  href: string;
  tone?: Tone;
  size?: "md" | "lg";
  className?: string;
  children: ReactNode;
}) {
  const cls =
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50 " +
    (size === "lg" ? "h-10 px-4 " : "h-9 px-3.5 ") +
    TONES[tone] +
    " " +
    className;
  return href.startsWith("/") || href.startsWith("#") ? (
    <Link href={href} className={cls}>
      {children}
    </Link>
  ) : (
    <a href={href} className={cls}>
      {children}
    </a>
  );
}

/**
 * The GitHub mark. Path from Simple Icons (CC0), rendered in the current text
 * colour so it sits with the rest of the header rather than as a brand splash.
 */
export function GithubMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} role="img" aria-hidden>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/* ---------- section furniture ---------- */

/** Small bordered pill with a mark, the section opener used below the hero. */
export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[12.5px] font-medium text-text-secondary">
      <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
      {children}
    </span>
  );
}

/**
 * A soft stage holding a piece of real UI, the reference's beige tile. The
 * crop sits on the dashboard's cream surface and is clipped by the tile.
 */
export function Stage({
  src,
  width,
  height,
  alt,
  zoom = 1,
  align = "left",
  className = "h-48",
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
  zoom?: number;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const pos = align === "left" ? "left-4 top-4" : align === "right" ? "right-4 top-4" : "left-1/2 top-4 -translate-x-1/2";
  return (
    <div className={"relative overflow-hidden rounded-xl bg-surface-2 " + className}>
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={"absolute max-w-none rounded-lg border border-border bg-surface shadow-[0_8px_24px_-12px_rgba(45,35,35,0.25)] " + pos}
        style={{ width: `${zoom * 100}%` }}
      />
    </div>
  );
}

/** Editorial kicker: a short rule, then a mono index and label. */
export function Kicker({ index, children, tone = "light" }: { index?: string; children: ReactNode; tone?: "light" | "dark" }) {
  const dark = tone === "dark";
  return (
    <p className={"flex items-center gap-3 font-mono text-[12px] uppercase tracking-[0.14em] " + (dark ? "text-white/60" : "text-muted")}>
      <span className={"h-px w-8 " + (dark ? "bg-white/30" : "bg-border-strong")} aria-hidden />
      {index && <span className={dark ? "text-white" : "text-brand-ink"}>{index}</span>}
      {index && <span aria-hidden>/</span>}
      {children}
    </p>
  );
}

/** The dashboard's uppercase page label, reused as a section eyebrow. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-muted">{children}</p>;
}

export function SectionHead({
  eyebrow,
  title,
  text,
  align = "left",
  size = "md",
}: {
  eyebrow: string;
  title: ReactNode;
  text?: ReactNode;
  align?: "left" | "center";
  size?: "md" | "lg";
}) {
  const centre = align === "center";
  return (
    <div className={centre ? "mx-auto flex max-w-2xl flex-col items-center text-center" : "max-w-xl"}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className={"display mt-4 " + (size === "lg" ? "text-[36px] sm:text-[44px] lg:text-[50px]" : "text-[32px] sm:text-[36px] lg:text-[40px]")}>
        {title}
      </h2>
      {text && <p className="mt-5 text-[17px] leading-relaxed text-text-secondary sm:text-[18px]">{text}</p>}
    </div>
  );
}

/* ---------- product imagery ---------- */

/**
 * The one treatment for every dashboard screenshot: white, a hairline
 * border, the dashboard's card radius, a whisper of shadow. No mockups.
 */
export function ProductFrame({
  src,
  width,
  height,
  alt,
  priority,
  eager,
  className = "",
  sizes,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
  priority?: boolean;
  /** In the first viewport but not the LCP: load with the document instead of lazily, without a preload competing with the fonts. */
  eager?: boolean;
  className?: string;
  /** Rendered width hint. Small collage tiles need it so they still fetch a sharp variant. */
  sizes?: string;
}) {
  return (
    <figure className={"overflow-hidden rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(45,35,35,0.04),0_12px_32px_-20px_rgba(45,35,35,0.25)] " + className}>
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        loading={eager && !priority ? "eager" : undefined}
        sizes={sizes ?? "(min-width: 1280px) 1200px, 100vw"}
        className="block w-full"
      />
    </figure>
  );
}

/**
 * Text beside product UI. Text always comes first in the DOM (so it is
 * first on mobile); `flip` puts the UI on the left at desktop widths.
 */
export function Split({
  flip = false,
  text,
  children,
}: {
  flip?: boolean;
  text: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-12">
      <div className={"lg:col-span-5 " + (flip ? "lg:order-2 lg:col-start-8" : "")}>{text}</div>
      <div className={"lg:col-span-7 " + (flip ? "lg:order-1 lg:col-start-1" : "")}>{children}</div>
    </div>
  );
}
