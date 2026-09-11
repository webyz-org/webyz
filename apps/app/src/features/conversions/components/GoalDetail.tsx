import { useMemo } from "react";
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
  type TooltipItem,
} from "chart.js";

import BreakdownList from "../../../shared/components/BreakdownList";
import { formatBucketLabel } from "../../pages/lib/format";
import {
  countryFlag,
  countryName,
  formatCount,
} from "../../../shared/lib/format";
import { useGoalDetail } from "../hooks/useConversionsFeature";
import type { PeriodWindow } from "../api";

ChartJS.register(
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Filler,
);

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className="rounded-xl border border-border bg-surface p-4">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
      {title}
    </h3>
    <div className="mt-3">{children}</div>
  </section>
);

/** One goal's conversion trend and who converts, below the goals table. */
export default function GoalDetail({
  siteId,
  goalId,
  range,
}: {
  siteId: string;
  goalId: string;
  range: PeriodWindow;
}) {
  const detail = useGoalDetail(siteId, goalId, range);
  const data = detail.data;
  const trend = data?.trend;

  const chartData = useMemo(
    () => ({
      labels: (trend?.labels ?? []).map((l) =>
        formatBucketLabel(l, trend?.interval ?? "day"),
      ),
      datasets: [
        {
          label: "Converting visitors",
          data: trend?.plot ?? [],
          borderColor: "#4f75fe",
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.35,
          fill: true,
          backgroundColor: "rgba(63,154,168,0.12)",
        },
      ],
    }),
    [trend],
  );

  const chartOptions = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index" as const, intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item: TooltipItem<"line">) =>
              ` ${item.parsed.y ?? 0} converting visitors`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: "#f0ece7" },
          ticks: { precision: 0 },
        },
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 24 } },
      },
    }),
    [],
  );

  if (detail.isError) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-text-muted">
        Unable to load this goal's details.
      </div>
    );
  }

  const totals = [
    { label: "Converting visitors", value: formatCount(data?.totals.visitors ?? 0) },
    { label: "Total conversions", value: formatCount(data?.totals.completions ?? 0) },
    { label: "Conversion rate", value: `${data?.totals.conversion_rate ?? 0}%` },
    { label: "All visitors", value: formatCount(data?.totals.total_visitors ?? 0) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
        {totals.map((cell) => (
          <div key={cell.label} className="bg-surface p-4">
            <span className="text-xs uppercase tracking-wide text-text-muted">
              {cell.label}
            </span>
            <div className="mt-1 text-xl font-semibold">
              {detail.isLoading && !data ? (
                <div className="h-6 w-14 animate-pulse rounded bg-black/5 dark:bg-white/10" />
              ) : (
                cell.value
              )}
            </div>
          </div>
        ))}
      </div>

      <Section title="Conversions over time">
        <div className="h-52 w-full">
          {detail.isLoading && !data ? (
            <div className="h-full w-full animate-pulse rounded bg-black/5 dark:bg-white/10" />
          ) : (
            <Line data={chartData} options={chartOptions} />
          )}
        </div>
      </Section>

      <div className="grid gap-4 md:grid-cols-3">
        <Section title="Converting sources">
          <BreakdownList rows={data?.sources} isLoading={detail.isLoading} />
        </Section>
        <Section title="Converting devices">
          <BreakdownList rows={data?.devices} isLoading={detail.isLoading} />
        </Section>
        <Section title="Converting countries">
          <BreakdownList
            rows={data?.countries}
            isLoading={detail.isLoading}
            formatName={(code) => (
              <>
                {countryFlag(code)} {countryName(code)}
              </>
            )}
          />
        </Section>
      </div>
    </div>
  );
}
