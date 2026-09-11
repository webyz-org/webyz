import type { ReactElement } from "react";
import {
  siAndroid,
  siApple,
  siDuckduckgo,
  siEcosia,
  siFacebook,
  siGoogle,
  siHuawei,
  siInstagram,
  siLinux,
  siOppo,
  siTiktok,
  siUbuntu,
  siVivo,
  siWechat,
  siX,
  siXiaomi,
} from "simple-icons";
import { CircleHelp, Cpu, Gamepad2, Monitor, Smartphone, Tablet, Tv, Watch } from "lucide-react";

import androidLogo from "@browser-logos/android-webview/android-webview_48x48.png";
import braveLogo from "@browser-logos/brave/brave_48x48.png";
import chromeLogo from "@browser-logos/chrome/chrome_48x48.png";
import edgeLogo from "@browser-logos/edge/edge_48x48.png";
import firefoxLogo from "@browser-logos/firefox/firefox_48x48.png";
import operaLogo from "@browser-logos/opera/opera_48x48.png";
import safariLogo from "@browser-logos/safari/safari_48x48.png";
import samsungLogo from "@browser-logos/samsung-internet/samsung-internet_48x48.png";
import ucLogo from "@browser-logos/uc/uc_48x48.png";
import vivaldiLogo from "@browser-logos/vivaldi/vivaldi_48x48.png";
import webkitLogo from "@browser-logos/webkit/webkit_48x48.png";
import yandexLogo from "@browser-logos/yandex/yandex_48x48.png";

/**
 * Row icons for the technology breakdowns.
 *
 * Browsers use the vendors' own logos (`@browser-logos`, the set Firefox and
 * others publish for this purpose), so Chrome is the Chrome mark rather than a
 * lookalike. Browsers that set has no logo for (in-app browsers such as
 * Facebook, and the Android OEM browsers that dominate Indian traffic) use
 * Simple Icons glyphs filled with each brand's official colour, as do the
 * platforms; Windows is drawn here because Simple Icons dropped Microsoft's
 * marks, and its logo is four squares.
 *
 * The names matched are what `ua-parser-js` reports and the ingest
 * normaliser (`utils/ua-normalizer`) passes through: "Facebook", "GSA" (the
 * Google app), "Vivo Browser", "HeyTap" (OPPO and realme's browser),
 * "HiBrowser" (Transsion: Tecno, Infinix, itel), "Twitter", "Android Browser",
 * "UCBrowser", "MIUI Browser", "Huawei Browser", "Yandex", "WebKit", plus the
 * raw values older rows carry ("Mobile Safari"). Anything unrecognised falls
 * back to a neutral glyph.
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
 * `colorClass` overrides that for the brands whose official colour cannot
 * survive both themes: Apple's, X's and TikTok's marks are black, which
 * disappears on the dark canvas, and Linux's yellow is illegible on white.
 * They keep their identity and swap tone per theme instead.
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

/** Black marks: near-black on the light canvas, near-white on the dark one. */
const MONO = "text-[#111112] dark:text-[#f4f4f5]";

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

/**
 * Order matters: several names contain another browser's name. Edge, Vivaldi
 * and the in-app browsers identify as Chromium-based, so they are tested
 * before Chrome; "Chrome WebView" must reach the Chrome row before the
 * Android row; and Chrome is tested before the Google app so an old
 * "Google Chrome" row keeps the Chrome mark.
 */
const BROWSERS: [RegExp, ReactElement][] = [
  [/edge/i, logo(edgeLogo, "Microsoft Edge")],
  [/opera/i, logo(operaLogo, "Opera")],
  [/brave/i, logo(braveLogo, "Brave")],
  [/vivaldi/i, logo(vivaldiLogo, "Vivaldi")],
  [/samsung/i, logo(samsungLogo, "Samsung Internet")],
  [/yandex/i, logo(yandexLogo, "Yandex Browser")],
  [/\buc\s*browser|^uc$/i, logo(ucLogo, "UC Browser")],
  [/duckduckgo/i, glyph(siDuckduckgo)],
  [/ecosia/i, glyph(siEcosia)],
  // In-app browsers.
  [/facebook/i, glyph(siFacebook)],
  [/instagram/i, glyph(siInstagram)],
  [/twitter|^x$/i, glyph(siX, MONO)],
  [/tiktok/i, glyph(siTiktok, MONO)],
  [/wechat|weixin/i, glyph(siWechat)],
  // Android OEM browsers.
  [/vivo/i, glyph(siVivo)],
  [/heytap|oppo|realme/i, glyph(siOppo)],
  [/miui|xiaomi|\bmi\s*browser/i, glyph(siXiaomi)],
  [/huawei/i, glyph(siHuawei)],
  // HiBrowser (Transsion) has no published mark; the Android robot stands in.
  [/hibrowser/i, glyph(siAndroid)],
  [/chrom/i, logo(chromeLogo, "Google Chrome")],
  // "GSA" is ua-parser's name for the Google app's built-in browser.
  [/^gsa$|google/i, glyph(siGoogle)],
  [/firefox|mozilla/i, logo(firefoxLogo, "Firefox")],
  [/safari/i, logo(safariLogo, "Safari")],
  [/webkit/i, logo(webkitLogo, "WebKit")],
  [/^android/i, logo(androidLogo, "Android Browser")],
];

const SYSTEMS: [RegExp, ReactElement][] = [
  [/windows/i, WINDOWS],
  // Chrome OS carries the Chrome mark; tested before the Apple row so nothing else claims it.
  [/chrom/i, logo(chromeLogo, "Chrome OS")],
  [/ubuntu/i, glyph(siUbuntu)],
  [/mac|ios|ipad|iphone/i, glyph(siApple, MONO)],
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
