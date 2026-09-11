import type { ReactElement } from "react";
import {
  siAndroid,
  siApple,
  siLinux,
  siUbuntu,
} from "simple-icons";
import { CircleHelp, Cpu, Gamepad2, Monitor, Smartphone, Tablet, Tv, Watch } from "lucide-react";

import braveLogo from "@browser-logos/brave/brave_48x48.png";
import chromeLogo from "@browser-logos/chrome/chrome_48x48.png";
import edgeLogo from "@browser-logos/edge/edge_48x48.png";
import firefoxLogo from "@browser-logos/firefox/firefox_48x48.png";
import operaLogo from "@browser-logos/opera/opera_48x48.png";
import safariLogo from "@browser-logos/safari/safari_48x48.png";
import samsungLogo from "@browser-logos/samsung-internet/samsung-internet_48x48.png";

/**
 * Row icons for the technology breakdowns.
 *
 * Browsers use the vendors' own logos (`@browser-logos`, the set Firefox and
 * others publish for this purpose), so Chrome is the Chrome mark rather than a
 * lookalike. Platforms use Simple Icons glyphs filled with each brand's
 * official colour; Windows is drawn here because Simple Icons dropped
 * Microsoft's marks, and its logo is four squares.
 *
 * The names matched are the families the ingest normaliser writes
 * (`utils/ua-normalizer`), plus the raw ua-parser values older rows carry
 * ("Mobile Safari"). Anything unrecognised falls back to a neutral glyph.
 */
const SIZE = 15;

/** A vendor logo bitmap. 48px source for sharpness on retina at this size. */
const logo = (src: string, alt: string): ReactElement => (
  <img
    src={src}
    alt=""
    title={alt}
    width={SIZE}
    height={SIZE}
    loading="lazy"
    decoding="async"
    className="shrink-0 rounded-[2px]"
  />
);

/**
 * A Simple Icons glyph in the brand's own colour.
 *
 * `colorClass` overrides that for the two brands whose official colour cannot
 * survive both themes: Apple's mark is black, which disappears on the dark
 * canvas, and Linux's yellow is illegible on white. Both keep their identity
 * and swap tone per theme instead.
 */
const glyph = (
  icon: { path: string; hex: string; title: string },
  colorClass?: string,
): ReactElement => (
  <svg
    viewBox="0 0 24 24"
    width={SIZE}
    height={SIZE}
    fill={colorClass ? "currentColor" : `#${icon.hex}`}
    className={"shrink-0 " + (colorClass ?? "")}
    role="img"
    aria-hidden
  >
    <title>{icon.title}</title>
    <path d={icon.path} />
  </svg>
);

/** Windows: four squares, Microsoft's flat blue. */
const WINDOWS: ReactElement = (
  <svg viewBox="0 0 24 24" width={SIZE} height={SIZE} className="shrink-0" aria-hidden>
    <g fill="#0078D4">
      <rect x="2" y="2" width="9" height="9" rx="1" />
      <rect x="13" y="2" width="9" height="9" rx="1" />
      <rect x="2" y="13" width="9" height="9" rx="1" />
      <rect x="13" y="13" width="9" height="9" rx="1" />
    </g>
  </svg>
);

const BROWSERS: [RegExp, ReactElement][] = [
  // Edge identifies as Chromium-based, so it has to be tested before Chrome.
  [/edge/i, logo(edgeLogo, "Microsoft Edge")],
  [/opera/i, logo(operaLogo, "Opera")],
  [/brave/i, logo(braveLogo, "Brave")],
  [/samsung/i, logo(samsungLogo, "Samsung Internet")],
  [/chrom/i, logo(chromeLogo, "Google Chrome")],
  [/firefox|mozilla/i, logo(firefoxLogo, "Firefox")],
  [/safari/i, logo(safariLogo, "Safari")],
];

const SYSTEMS: [RegExp, ReactElement][] = [
  [/windows/i, WINDOWS],
  [/ubuntu/i, glyph(siUbuntu)],
  [/mac|ios|ipad|iphone/i, glyph(siApple, "text-[#111112] dark:text-[#f4f4f5]")],
  [/android/i, glyph(siAndroid)],
  [/linux|debian|fedora/i, glyph(siLinux, "text-[#b58900] dark:text-[#fcc624]")],
];

const DEVICES: [RegExp, ReactElement][] = [
  [/desktop/i, <Monitor size={14} className="shrink-0 text-text-muted" aria-hidden />],
  [/mobile|phone/i, <Smartphone size={14} className="shrink-0 text-text-muted" aria-hidden />],
  [/tablet/i, <Tablet size={14} className="shrink-0 text-text-muted" aria-hidden />],
  [/tv/i, <Tv size={14} className="shrink-0 text-text-muted" aria-hidden />],
  [/console/i, <Gamepad2 size={14} className="shrink-0 text-text-muted" aria-hidden />],
  [/wear|watch/i, <Watch size={14} className="shrink-0 text-text-muted" aria-hidden />],
];

const UNKNOWN_BROWSER = <Cpu size={14} className="shrink-0 text-text-muted" aria-hidden />;
const UNKNOWN_SYSTEM = <Cpu size={14} className="shrink-0 text-text-muted" aria-hidden />;
const UNKNOWN_DEVICE = <CircleHelp size={14} className="shrink-0 text-text-muted" aria-hidden />;

const match = (table: [RegExp, ReactElement][], name?: string) =>
  name ? table.find(([test]) => test.test(name))?.[1] : undefined;

export function BrowserIcon({ name }: { name?: string }) {
  return match(BROWSERS, name) ?? UNKNOWN_BROWSER;
}

export function OSIcon({ name }: { name?: string }) {
  return match(SYSTEMS, name) ?? UNKNOWN_SYSTEM;
}

export function DeviceIcon({ name }: { name?: string }) {
  return match(DEVICES, name) ?? UNKNOWN_DEVICE;
}
