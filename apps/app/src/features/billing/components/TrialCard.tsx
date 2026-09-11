import { Card, CardContent } from "../../../shared/components/ui/card";
import { formatCount } from "../../../shared/lib/format";
import type { UsageSummary } from "../types";

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

/**
 * Trial state, stated plainly: what you have, how long, what happens after.
 * No countdown theatrics; the "what happens after" line is the point.
 */
export default function TrialCard({ summary }: { summary: UsageSummary }) {
  const trial = summary.trial;
  if (!trial) return null;

  const over = summary.sites.active + summary.sites.inactive.length - summary.sites.limit;
  const days = trial.daysRemaining;
  const urgent = days <= 3;

  return (
    <Card className={urgent ? "border-warning" : "border-brand"}>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">
            {trial.planName} trial
            <span className="ml-2 rounded bg-primary-soft px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-ink">
              Active
            </span>
          </h2>
          <span className={"text-sm " + (urgent ? "text-warning" : "text-text-secondary")}>
            {days === 0 ? "Ends today" : `${days} day${days === 1 ? "" : "s"} remaining`}
          </span>
        </div>
        <p className="text-sm text-text-secondary">
          You have the full {trial.planName} plan until {longDate(trial.endsAt)}: {formatCount(summary.usage.includedEvents)}{" "}
          events and up to {summary.sites.limit} website{summary.sites.limit === 1 ? "" : "s"}. No card, nothing charged.
        </p>
        <p className="text-sm text-text-muted">
          When it ends your account moves to the {trial.fallbackPlanName} plan unless you choose a paid one. Your data is
          kept either way.
          {over > 0 && (
            <>
              {" "}
              The {trial.fallbackPlanName} plan allows fewer websites than you have; you will be asked which to keep active.
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
