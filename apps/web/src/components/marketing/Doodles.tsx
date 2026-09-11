import type { ReactNode } from "react";

/* Hand-drawn strokes from the reference, redrawn in ink. All decorative. */

export function CurlArrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 90" className={className} fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 70 C 20 30, 50 20, 60 40 C 66 52, 52 60, 48 50 C 44 38, 70 24, 100 30" />
      <path d="M88 18 L 104 30 L 88 42" />
    </svg>
  );
}

export function BendArrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 90 100" className={className} fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 8 C 40 14, 62 40, 66 84" />
      <path d="M50 72 L 66 88 L 80 70" />
    </svg>
  );
}

export function HookArrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 60" className={className} fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M110 44 C 80 8, 40 4, 12 22" />
      <path d="M26 10 L 10 24 L 26 36" />
    </svg>
  );
}

export function SmallArrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 70 40" className={className} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12 C 24 6, 44 12, 62 30" />
      <path d="M46 30 L 63 31 L 60 14" />
    </svg>
  );
}

export function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
    </svg>
  );
}

export function Squiggle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 60" className={className} fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden>
      <path d="M6 50 C 20 6, 44 4, 40 26 C 37 42, 60 40, 74 30" />
    </svg>
  );
}

/** Rotated label sticker: white face, ink border, uppercase. */
export function Sticker({ children, className = "", tone = "light" }: { children: ReactNode; className?: string; tone?: "light" | "dark" | "blue" | "green" }) {
  const face = {
    light: "border-ink bg-surface text-ink",
    dark: "border-ink bg-ink text-white",
    blue: "border-brand-ink bg-brand text-white",
    green: "border-success bg-success text-white",
  }[tone];
  return (
    <span className={"pointer-events-none absolute z-20 inline-flex items-center gap-1.5 rounded-md border-2 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide shadow-[3px_3px_0_rgba(45,35,35,0.9)] " + face + " " + className}>
      {children}
    </span>
  );
}
