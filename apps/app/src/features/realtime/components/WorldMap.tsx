import { useEffect, useRef, useState } from "react";
import {
  geoDistance,
  geoNaturalEarth1,
  geoOrthographic,
  geoPath,
  type GeoSphere,
} from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";

import topology from "world-atlas/countries-110m.json";
import rawCentroids from "../country-centroids.json";
import { countryName } from "../../../shared/lib/format";

/**
 * The realtime map: an SVG globe (orthographic) or flat map (Natural Earth)
 * over the same data layer. Visitors are aggregated per country - Webyz's geo
 * data is country/region/city with no coordinates, so country centroids are
 * the honest maximum precision. That aggregation is also the clustering: 5000
 * visitors render as at most ~200 markers, never one node per visitor.
 *
 * SVG rather than WebGL keeps the dependency small and the fallback story
 * trivial; at 110m resolution the world is ~180 paths, cheap to re-project.
 */

const W = 800;
const H = 500;
const SPHERE: GeoSphere = { type: "Sphere" };
const CENTROIDS = rawCentroids as Record<string, number[]>;

// Parsed once at module load. If the atlas ever fails to parse, the page
// falls back to a message and the list/feed keep working.
let COUNTRY_FEATURES: GeoJSON.Feature[] = [];
try {
  const atlas = topology as unknown as Topology<{
    countries: GeometryCollection;
  }>;
  COUNTRY_FEATURES = feature(atlas, atlas.objects.countries).features;
} catch {
  COUNTRY_FEATURES = [];
}

export type MapMarker = {
  country: string;
  count: number;
  active: boolean;
  lastActiveAgo: string;
};

type Props = {
  mode: "globe" | "flat";
  markers: MapMarker[];
  selectedCountry: string | null;
  onSelectCountry: (country: string | null) => void;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const markerRadius = (count: number) =>
  clamp(7 + Math.sqrt(count) * 2, 8, 16);

export default function WorldMap({
  mode,
  markers,
  selectedCountry,
  onSelectCountry,
}: Props) {
  // Globe state: rotation [lambda, phi] plus a zoom factor.
  const [rotation, setRotation] = useState<[number, number]>([-20, -18]);
  const [globeZoom, setGlobeZoom] = useState(1);
  // Flat state: pan/zoom transform on a <g>, so the base paths never change.
  const [flat, setFlat] = useState({ k: 1, x: 0, y: 0 });
  const [animateFlat, setAnimateFlat] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    rotation: [number, number];
    flat: { k: number; x: number; y: number };
  } | null>(null);
  const lastInteractionRef = useRef(0);

  const isGlobe = mode === "globe";

  const projection = isGlobe
    ? geoOrthographic()
        .rotate(rotation)
        .scale((H / 2 - 12) * globeZoom)
        .translate([W / 2, H / 2])
    : geoNaturalEarth1().fitSize([W, H], SPHERE);

  const path = geoPath(projection);

  // Slow auto-rotation that yields to the user: paused while dragging, for a
  // few seconds after any interaction, when a country is selected, and while
  // the tab is hidden.
  useEffect(() => {
    if (!isGlobe || selectedCountry) return;
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 50) return; // ~20fps is plenty for a slow drift
      const dt = t - last;
      last = t;
      if (document.hidden || dragRef.current) return;
      if (performance.now() - lastInteractionRef.current < 4000) return;
      setRotation(([lambda, phi]) => [lambda + dt * 0.003, phi]);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isGlobe, selectedCountry]);

  // Center the selection: rotate the globe to it, or zoom the flat map into
  // it. Render-phase adjustment rather than an effect, so there is no flash
  // of the old position.
  const [centeredOn, setCenteredOn] = useState<string | null>(null);
  if (selectedCountry !== centeredOn) {
    setCenteredOn(selectedCountry);
    const centroid = selectedCountry ? CENTROIDS[selectedCountry] : undefined;
    if (centroid) {
      const [lon, lat] = centroid;
      if (isGlobe) {
        setRotation([-lon, -lat]);
      } else {
        const base = geoNaturalEarth1().fitSize([W, H], SPHERE);
        const point = base([lon, lat]);
        if (point) {
          const k = 2.5;
          setAnimateFlat(true);
          setFlat({ k, x: W / 2 - point[0] * k, y: H / 2 - point[1] * k });
        }
      }
    }
  }

  // Wheel zoom needs a non-passive listener, so React's onWheel is no use.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      lastInteractionRef.current = performance.now();
      const factor = Math.exp(-event.deltaY * 0.0015);

      if (isGlobe) {
        setGlobeZoom((z) => clamp(z * factor, 0.7, 4));
        return;
      }

      const rect = svg.getBoundingClientRect();
      const px = ((event.clientX - rect.left) / rect.width) * W;
      const py = ((event.clientY - rect.top) / rect.height) * H;
      setAnimateFlat(false);
      setFlat((prev) => {
        const k = clamp(prev.k * factor, 1, 8);
        const scale = k / prev.k;
        return {
          k,
          x: px - (px - prev.x) * scale,
          y: py - (py - prev.y) * scale,
        };
      });
    };

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [isGlobe]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      rotation,
      flat,
    };
    lastInteractionRef.current = performance.now();
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    lastInteractionRef.current = performance.now();

    if (isGlobe) {
      const speed = 0.35 / globeZoom;
      setRotation([
        drag.rotation[0] + dx * speed,
        clamp(drag.rotation[1] - dy * speed, -80, 80),
      ]);
    } else {
      setAnimateFlat(false);
      setFlat({ k: drag.flat.k, x: drag.flat.x + dx, y: drag.flat.y + dy });
    }
  };

  const endDrag = () => {
    dragRef.current = null;
    lastInteractionRef.current = performance.now();
  };

  if (COUNTRY_FEATURES.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Map data unavailable. The visitor list on the right still updates live.
      </div>
    );
  }

  const renderMarker = (marker: MapMarker) => {
    const centroid = CENTROIDS[marker.country];
    if (!centroid) return null;
    const [lon, lat] = centroid;

    if (
      isGlobe &&
      geoDistance([lon, lat], [-rotation[0], -rotation[1]]) > Math.PI / 2 - 0.05
    ) {
      return null; // far side of the globe
    }

    const point = projection([lon, lat]);
    if (!point) return null;

    const r = markerRadius(marker.count);
    const selected = marker.country === selectedCountry;
    const label = `${countryName(marker.country) || marker.country}: ${marker.count} visitor${marker.count === 1 ? "" : "s"}, active ${marker.lastActiveAgo}`;
    const counterScale = isGlobe ? 1 : 1 / flat.k;

    return (
      <g
        key={marker.country}
        transform={`translate(${point[0]}, ${point[1]}) scale(${counterScale})`}
        className="cursor-pointer"
        role="button"
        aria-label={label}
        aria-pressed={selected}
        tabIndex={0}
        onClick={(event) => {
          event.stopPropagation();
          onSelectCountry(selected ? null : marker.country);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectCountry(selected ? null : marker.country);
          }
        }}
      >
        {marker.active && (
          <circle
            r={r + 5}
            className="animate-ping fill-primary/30"
            style={{ transformOrigin: "0 0" }}
          />
        )}
        <circle
          r={r}
          className={
            (selected ? "fill-primary" : "fill-primary/75") +
            " stroke-surface transition-[fill]"
          }
          strokeWidth={1.5}
        />
        <text
          textAnchor="middle"
          dy="3.5"
          className="pointer-events-none select-none fill-white text-[10px] font-semibold"
        >
          {marker.count}
        </text>
        <title>{label}</title>
      </g>
    );
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="h-full w-full touch-none"
      role="img"
      aria-label="World map of active visitors"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onClick={() => onSelectCountry(null)}
    >
      {isGlobe ? (
        <>
          <path
            d={path(SPHERE) ?? undefined}
            className="fill-black/[0.03] stroke-border dark:fill-white/[0.04]"
          />
          {COUNTRY_FEATURES.map((f, i) => (
            <path
              key={String(f.id ?? i)}
              d={path(f) ?? undefined}
              className="fill-black/[0.08] stroke-surface dark:fill-white/[0.12]"
              strokeWidth={0.5}
            />
          ))}
          {markers.map(renderMarker)}
        </>
      ) : (
        <g
          style={{
            transform: `translate(${flat.x}px, ${flat.y}px) scale(${flat.k})`,
            transition: animateFlat ? "transform 350ms ease" : undefined,
          }}
        >
          {COUNTRY_FEATURES.map((f, i) => (
            <path
              key={String(f.id ?? i)}
              d={path(f) ?? undefined}
              className="fill-black/[0.08] stroke-surface dark:fill-white/[0.12]"
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {markers.map(renderMarker)}
        </g>
      )}
    </svg>
  );
}
