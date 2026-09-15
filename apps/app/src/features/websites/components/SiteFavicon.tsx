import { useState } from "react";

import { API_BASE_URL } from "../../../config/env";
import { API_PREFIX } from "../../../lib/axios";

/**
 * The two places a site is identified by a mark: the 40px tile in the website
 * list, and the 20px tile in the header's site switcher. Both keep the
 * initial as the fallback, so the size lives here rather than being passed in
 * as loose classes.
 */
const SIZES = {
  sm: { tile: "h-5 w-5 rounded text-[11px] font-semibold", icon: "h-4 w-4 rounded-[2px]" },
  md: { tile: "h-10 w-10 rounded-lg text-base font-bold", icon: "h-[22px] w-[22px] rounded-[3px]" },
} as const;

/**
 * A site's own icon, falling back to its initial on a coloured tile.
 *
 * The icon comes from our API, never from an icon service directly: a browser
 * asking Google or DuckDuckGo for each row would hand that service the
 * signed-in user's whole list of domains. The API caches and answers 404 when
 * no upstream has an icon, which is the normal case for a site added minutes
 * ago, so the fallback is not an edge case and has to look deliberate.
 *
 * The image is always rendered and only faded in, never `hidden` and never
 * lazy. Both would stop it loading at all: an image with `display: none` has
 * no box, so it is never fetched, so `onLoad` never fires, so it is never
 * shown. It is positioned over the tile rather than beside the initial, so
 * the two states share one box and nothing flashes empty or resizes when the
 * icon arrives.
 */
export default function SiteFavicon({
  domain,
  tone,
  size = "md",
}: {
  domain: string;
  /** Tile background and text colour while the initial is showing. */
  tone: string;
  size?: keyof typeof SIZES;
}) {
  const [loaded, setLoaded] = useState(false);
  const { tile, icon } = SIZES[size];

  return (
    <span
      className={
        `relative flex shrink-0 items-center justify-center uppercase ${tile} ` +
        (loaded ? "bg-black/[0.04] dark:bg-white/[0.06]" : tone)
      }
    >
      {!loaded && (domain[0] ?? "?")}
      <img
        src={`${API_BASE_URL}${API_PREFIX}/favicon/${encodeURIComponent(domain)}`}
        alt=""
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={
          `absolute inset-0 m-auto object-contain transition-opacity duration-150 ${icon} ` +
          (loaded ? "opacity-100" : "opacity-0")
        }
      />
    </span>
  );
}
