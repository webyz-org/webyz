import { Button } from "../../../shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/ui/dialog";
import { formatCount, formatMoney } from "../../../shared/lib/format";
import { useChangePlan, useChangePreview } from "../hooks/useBilling";
import type { Plan } from "../types";

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

/**
 * Before a plan change: what you get, what you lose, which sites would go
 * inactive, and when it happens. The customer confirms with the facts in
 * front of them. Nothing here deletes anything.
 */
export default function PlanChangeDialog({
  target,
  onClose,
}: {
  target: { plan: Plan; billingCycle: "MONTHLY" | "YEARLY" } | null;
  onClose: () => void;
}) {
  const preview = useChangePreview(target ? { planId: target.plan.id, billingCycle: target.billingCycle } : null);
  const change = useChangePlan();
  const p = preview.data;

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {p ? (p.kind === "downgrade" ? `Move to ${p.to.name}` : `Upgrade to ${p.to.name}`) : "Change plan"}
          </DialogTitle>
          <DialogDescription>
            {p
              ? p.effective === "now"
                ? "Takes effect immediately."
                : `Takes effect on ${longDate(p.effectiveAt!)}, when your current period ends. Until then nothing changes.`
              : "Loading the comparison..."}
          </DialogDescription>
        </DialogHeader>

        {preview.error && <p className="text-sm text-danger">{(preview.error as { message?: string }).message}</p>}

        {p && (
          <div className="space-y-4 text-sm">
            <div className="flex items-baseline justify-between rounded-md border border-border px-3 py-2">
              <span className="text-text-secondary">
                {p.from.name}, {formatMoney(p.from.priceCents)} {p.from.cycle === "YEARLY" ? "a year" : "a month"}
              </span>
              <span aria-hidden className="text-text-muted">
                to
              </span>
              <span className="font-medium">
                {p.to.name}, {formatMoney(p.to.priceCents)} {p.to.cycle === "YEARLY" ? "a year" : "a month"}
              </span>
            </div>

            {p.diff.limits.length > 0 && (
              <ul className="space-y-1">
                {p.diff.limits.map((l) => (
                  <li key={l.key} className="flex justify-between">
                    <span className="text-text-secondary">{l.label}</span>
                    <span className={"tabular-nums " + (l.to < l.from ? "text-warning" : "text-text-primary")}>
                      {formatCount(l.from)} to {formatCount(l.to)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {p.diff.featuresLost.length > 0 && (
              <p>
                <span className="text-text-secondary">You lose: </span>
                {p.diff.featuresLost.map((f) => f.label).join(", ")}.
              </p>
            )}
            {p.diff.featuresGained.length > 0 && (
              <p>
                <span className="text-text-secondary">You gain: </span>
                {p.diff.featuresGained.map((f) => f.label).join(", ")}.
              </p>
            )}

            {p.sites.wouldGoInactive.length > 0 && (
              <div className="rounded-md border border-warning/50 bg-warning/5 px-3 py-2">
                <p className="font-medium text-warning">
                  {p.sites.wouldGoInactive.length} of your {p.sites.total} sites would stop collecting new data
                </p>
                <p className="text-text-secondary">
                  {p.sites.wouldGoInactive.map((s) => s.domain).join(", ")}. Their history is kept, and you can choose which
                  sites stay active afterwards.
                </p>
              </div>
            )}

            {p.notes.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-text-secondary">
                {p.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {change.error && <p className="text-sm text-danger">{(change.error as { message?: string }).message}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={change.isPending}>
            Keep current plan
          </Button>
          <Button
            onClick={() =>
              target && change.mutate({ planId: target.plan.id, billingCycle: target.billingCycle }, { onSuccess: onClose })
            }
            disabled={!p || change.isPending}
          >
            {change.isPending ? "Applying..." : p?.effective === "now" ? "Confirm change" : "Schedule change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
