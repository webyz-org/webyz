/**
 * Tiny inline trend line for a KPI tile. Pure SVG, no axes; it only has to
 * show the shape of the period at a glance.
 */
export default function Sparkline({
  values,
  width = 72,
  height = 22,
  className = "",
  fit = false,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Allow the flex row to shrink it below `width` so a neighbour never wraps. */
  fit?: boolean;
}) {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pad = 1.5;

  const points = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (width - pad * 2);
      const y = pad + (1 - (v - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={(fit ? "min-w-0 shrink " : "shrink-0 ") + "overflow-visible " + className}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
