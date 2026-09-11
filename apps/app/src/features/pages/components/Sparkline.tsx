import { useRef, useState } from "react";

import { formatBucketLabel } from "../lib/format";

/**
 * Compact pageview trend for a table row. Pure SVG so a hundred rows cost
 * nothing; hovering reveals the bucket's label and count. Rendered only when
 * there are at least two buckets with any data, per the "no fake sparklines"
 * rule.
 */
export default function Sparkline({
  values,
  labels,
  interval,
  width = 110,
  height = 26,
}: {
  values: number[];
  labels: string[];
  interval: string;
  width?: number;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const total = values.reduce((a, b) => a + b, 0);
  if (values.length < 2 || total === 0) {
    return <span className="text-xs text-text-muted">—</span>;
  }

  const max = Math.max(...values, 1);
  const pad = 2;
  const stepX = (width - pad * 2) / (values.length - 1);
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);
  const points = values
    .map((v, i) => `${(pad + i * stepX).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");

  const summary = `Pageviews trend: ${total} views across ${values.length} ${
    interval === "hour" ? "hours" : interval === "month" ? "months" : "days"
  }`;

  const onMove = (e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left - pad;
    const index = Math.min(
      values.length - 1,
      Math.max(0, Math.round(x / stepX)),
    );
    setHover(index);
  };

  return (
    <div
      ref={wrapRef}
      className="relative inline-block align-middle"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={summary}
        className="block"
      >
        <polyline
          points={points}
          fill="none"
          stroke="#4f75fe"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hover !== null && (
          <circle
            cx={pad + hover * stepX}
            cy={y(values[hover])}
            r="2.5"
            fill="#4f75fe"
          />
        )}
      </svg>

      {hover !== null && labels[hover] && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/80 dark:bg-white/90 dark:text-black px-2 py-1 text-[11px] leading-tight text-white">
          {formatBucketLabel(labels[hover], interval)}
          <br />
          {values[hover]} {values[hover] === 1 ? "view" : "views"}
        </div>
      )}
    </div>
  );
}
