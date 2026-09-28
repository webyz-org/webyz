import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";

import { formatBucketLabel } from "../../pages/lib/format";
import { useTheme } from "../../../shared/lib/theme";
import type { OutboundTimeseries } from "../../dashboard/types";

ChartJS.register(LineElement, CategoryScale, LinearScale, PointElement, Tooltip, Filler, Legend);

/**
 * Per theme, because chart.js cannot read CSS tokens. Line, grid and tick
 * values match MainGraph's palettes so the two charts read as one system.
 */
const PALETTES = {
  light: {
    line: "#4f75fe",
    fillTop: "rgba(79,117,254,0.25)",
    fillBottom: "rgba(79,117,254,0.02)",
    secondary: "#9aa4b8",
    grid: "rgba(45, 35, 35, 0.06)",
    ticks: "#8a7878",
  },
  dark: {
    line: "#7b95ff",
    fillTop: "rgba(123,149,255,0.22)",
    fillBottom: "rgba(123,149,255,0.02)",
    secondary: "#70707a",
    grid: "rgba(255, 255, 255, 0.07)",
    ticks: "#70707a",
  },
} as const;

/**
 * Outbound clicks and clicking visitors per bucket. Same chart conventions as
 * the page detail trend: labels arrive in the site's timezone and are
 * formatted as strings, never parsed as dates.
 */
export default function OutboundTrend({
  series,
  isLoading,
  label = "Clicks",
}: {
  series?: OutboundTimeseries;
  isLoading: boolean;
  /** Name of the count line: "Clicks" or "Downloads". */
  label?: string;
}) {
  const palette = PALETTES[useTheme()];
  const data = useMemo(
    () => ({
      labels: (series?.labels ?? []).map((l) => formatBucketLabel(l, series?.interval ?? "day")),
      datasets: [
        {
          label,
          data: series?.clicks ?? [],
          borderColor: palette.line,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.35,
          fill: true,
          backgroundColor: (context: { chart: { ctx: CanvasRenderingContext2D } }) => {
            const gradient = context.chart.ctx.createLinearGradient(0, 0, 0, 240);
            gradient.addColorStop(0, palette.fillTop);
            gradient.addColorStop(1, palette.fillBottom);
            return gradient;
          },
        },
        {
          label: "Visitors",
          data: series?.visitors ?? [],
          borderColor: palette.secondary,
          borderDash: [4, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.35,
          fill: false,
        },
      ],
    }),
    [series, label, palette],
  );

  const options = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index" as const, intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "top",
          align: "end",
          labels: { boxWidth: 10, usePointStyle: true, color: palette.ticks },
        },
        tooltip: {
          callbacks: {
            label: (item: TooltipItem<"line">) => ` ${item.dataset.label}: ${item.parsed.y ?? 0}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: palette.grid },
          ticks: { precision: 0, color: palette.ticks },
        },
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 24, color: palette.ticks } },
      },
    }),
    [palette],
  );

  if (isLoading && !series) {
    return <div className="h-64 animate-pulse rounded-lg bg-black/[0.04] dark:bg-white/[0.06]" />;
  }

  return (
    <div className="h-64">
      <Line data={data} options={options} />
    </div>
  );
}
