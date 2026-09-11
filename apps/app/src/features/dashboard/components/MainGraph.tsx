import { useRef } from "react";
import { Line } from "react-chartjs-2";
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartOptions,
  type Plugin,
  type TooltipModel,
} from "chart.js";
import { ChevronDown } from "lucide-react";

import {
  GRAPH_METRICS,
  type GraphMetric,
  type MetricSeries,
} from "../hooks/useDashboard";
import {
  METRIC_LABELS,
  SHORT_METRIC_LABELS,
  formatAxisLabel,
  formatBucketTitle,
} from "../labels";
import { formatDuration } from "../../../shared/lib/format";
import { useTheme } from "../../../shared/lib/theme";
import { INTERVAL_LABELS, type GraphInterval } from "../../../config/periods";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../../shared/components/ui/dropdown-menu";

ChartJS.register(
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Filler,
  Tooltip,
);

ChartJS.defaults.font.family = "'DM Sans', sans-serif";

const formatMetricValue = (metric: GraphMetric, value: number) => {
  switch (metric) {
    case "bounce_rate":
      return `${value}%`;
    case "visit_duration":
      return formatDuration(value);
    case "views_per_visit":
      return value.toFixed(2);
    default:
      return value.toLocaleString();
  }
};

/** Matches --brand per theme; chart.js needs literals, not CSS classes. */
const PALETTES = {
  light: {
    line: "#4f75fe",
    fill: "rgba(79, 117, 254, 0.06)",
    grid: "rgba(45, 35, 35, 0.06)",
    ticks: "#8a7878",
    crosshair: "rgba(45, 35, 35, 0.2)",
    pointBorder: "#ffffff",
  },
  dark: {
    line: "#7b95ff",
    fill: "rgba(123, 149, 255, 0.08)",
    grid: "rgba(255, 255, 255, 0.07)",
    ticks: "#70707a",
    crosshair: "rgba(255, 255, 255, 0.25)",
    pointBorder: "#18181a",
  },
} as const;

/** Dashed vertical guide through the hovered bucket. */
const crosshair = (color: string): Plugin<"line"> => ({
  id: "crosshair",
  afterDraw(chart) {
    const active = chart.tooltip?.getActiveElements();
    if (!active?.length) return;
    const { ctx, chartArea } = chart;
    const x = active[0].element.x;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = color;
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
});

/** Small bordered select used in the chart header. */
function HeaderSelect<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={options.length < 2}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[13px] font-medium text-text-primary transition-colors duration-150 hover:border-border-strong hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-surface"
        >
          {current}
          {options.length > 1 && (
            <ChevronDown size={13} className="text-text-muted" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => onChange(v as T)}
        >
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Builds a "label ......... value" row for the HTML tooltip. */
const tooltipRow = (label: string, value: string, emphasis: boolean) => {
  const row = document.createElement("div");
  row.className =
    "flex items-baseline justify-between gap-6 text-xs " +
    (emphasis ? "text-text-primary" : "text-text-secondary");
  const name = document.createElement("span");
  name.textContent = label;
  const num = document.createElement("span");
  num.className = "font-medium tabular-nums text-text-primary";
  num.textContent = value;
  row.append(name, num);
  return row;
};

/**
 * The main chart with its own header controls: which metric to plot and the
 * bucket size. Every metric's series is already loaded for the KPI
 * sparklines, so switching is instant and the tooltip can show visitors,
 * visits and pageviews for the hovered bucket regardless of the plotted one.
 * The tooltip is HTML (positioned by chart.js) so its columns align.
 */
export default function MainGraph({
  series,
  isLoading,
  metric,
  onMetricChange,
  interval,
  intervalOptions,
  onIntervalChange,
}: {
  series: MetricSeries;
  isLoading: boolean;
  metric: GraphMetric;
  onMetricChange: (metric: GraphMetric) => void;
  interval: GraphInterval;
  intervalOptions: GraphInterval[];
  onIntervalChange: (interval: GraphInterval) => void;
}) {
  const theme = useTheme();
  const palette = PALETTES[theme];
  const tooltipRef = useRef<HTMLDivElement>(null);

  const current = series[metric];
  // The API may widen the interval; labels are formatted for what came back.
  const effectiveInterval = current?.interval ?? interval;
  const rawLabels = current?.labels ?? [];

  const chartData = {
    labels: rawLabels.map((l) => formatAxisLabel(l, effectiveInterval)),
    datasets: [
      {
        label: METRIC_LABELS[metric],
        data: current?.plot ?? [],
        borderColor: palette.line,
        borderWidth: 1.75,
        pointRadius: 0,
        pointHitRadius: 12,
        pointHoverRadius: 3.5,
        pointHoverBackgroundColor: palette.line,
        pointHoverBorderColor: palette.pointBorder,
        pointHoverBorderWidth: 2,
        tension: 0.35,
        fill: true,
        backgroundColor: palette.fill,
      },
    ],
  };

  const renderTooltip = ({
    chart,
    tooltip,
  }: {
    chart: ChartJS<"line">;
    tooltip: TooltipModel<"line">;
  }) => {
    const el = tooltipRef.current;
    if (!el) return;

    if (tooltip.opacity === 0) {
      el.style.opacity = "0";
      return;
    }

    const i = tooltip.dataPoints?.[0]?.dataIndex;
    if (i === undefined) return;

    // Always show the headline trio; prepend the plotted metric when it is
    // something else.
    const rows: GraphMetric[] = ["visitors", "visits", "pageviews"];
    if (!rows.includes(metric)) rows.unshift(metric);

    const title = document.createElement("div");
    title.className = "mb-2 text-[11px] font-medium text-text-muted";
    title.textContent = rawLabels[i]
      ? formatBucketTitle(rawLabels[i], effectiveInterval)
      : "";

    el.replaceChildren(
      title,
      ...rows
        .filter((m) => series[m]?.plot[i] !== undefined)
        .map((m) =>
          tooltipRow(
            SHORT_METRIC_LABELS[m],
            formatMetricValue(m, series[m]!.plot[i]),
            m === metric,
          ),
        ),
    );

    // Sit to the right of the crosshair, flip left near the edge, and keep
    // the box inside the plot vertically.
    const gap = 14;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const flip = tooltip.caretX + gap + width > chart.width;
    const left = flip
      ? tooltip.caretX - gap - width
      : tooltip.caretX + gap;
    const top = Math.min(
      Math.max(tooltip.caretY - height / 2, chart.chartArea.top),
      chart.chartArea.bottom - height,
    );

    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    el.style.opacity = "1";
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300, easing: "easeOutQuart" },
    interaction: { mode: "index" as const, intersect: false },
    layout: { padding: { top: 8, right: 4 } },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false, external: renderTooltip },
    },
    scales: {
      y: {
        beginAtZero: true,
        border: { display: false },
        grid: { color: palette.grid, drawTicks: false },
        ticks: {
          precision: 0,
          color: palette.ticks,
          font: { size: 11 },
          maxTicksLimit: 5,
          padding: 10,
          callback: (value) =>
            metric === "bounce_rate"
              ? `${value}%`
              : typeof value === "number" && value >= 1000
                ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
                : String(value),
        },
      },
      x: {
        border: { display: false },
        grid: { display: false },
        ticks: {
          maxRotation: 0,
          autoSkipPadding: 32,
          color: palette.ticks,
          font: { size: 11 },
          padding: 8,
        },
      },
    },
  };

  const plugins = [crosshair(palette.crosshair)];

  return (
    <div className="px-5 pb-4 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-text-primary">
            {METRIC_LABELS[metric]}
          </h2>
          <span className="text-xs text-text-muted">
            {INTERVAL_LABELS[effectiveInterval as GraphInterval] ??
              effectiveInterval}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <HeaderSelect
            label="Metric"
            value={metric}
            options={GRAPH_METRICS.map((m) => ({
              value: m,
              label: SHORT_METRIC_LABELS[m],
            }))}
            onChange={onMetricChange}
          />
          <HeaderSelect
            label="Interval"
            value={interval}
            options={intervalOptions.map((i) => ({
              value: i,
              label: INTERVAL_LABELS[i],
            }))}
            onChange={onIntervalChange}
          />
        </div>
      </div>

      <div className="relative mt-4 h-[300px] w-full">
        {isLoading && !current ? (
          <div className="h-full w-full animate-pulse rounded-lg bg-black/[0.04] dark:bg-white/[0.06]" />
        ) : (
          <>
            <Line data={chartData} options={options} plugins={plugins} />
            <div
              ref={tooltipRef}
              role="tooltip"
              className="pointer-events-none absolute left-0 top-0 z-10 min-w-[172px] rounded-lg border border-border bg-surface px-3 py-2.5 shadow-lg transition-opacity duration-150 [&>div+div]:mt-1.5"
              style={{ opacity: 0 }}
            />
          </>
        )}
      </div>
    </div>
  );
}
