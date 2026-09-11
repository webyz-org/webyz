import { Button } from "../../../shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/ui/dialog";
import { formatCount } from "../../../shared/lib/format";
import { useCancelPreview, useCancelSubscription } from "../hooks/useBilling";

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

/** Cancellation stated plainly: until when, what comes after, and that data stays. */
export default function CancelDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const preview = useCancelPreview(open);
  const cancel = useCancelSubscription();
  const p = preview.data;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel your {p?.planName ?? ""} plan?</DialogTitle>
          <DialogDescription>
            {p?.accessUntil
              ? `You keep everything until ${longDate(p.accessUntil)}. Nothing more is charged after that.`
              : "Loading..."}
          </DialogDescription>
        </DialogHeader>

        {p && (
          <div className="space-y-3 text-sm">
            <p>
              After that your account moves to the {p.fallbackPlanName} plan: {p.fallback.sites} website
              {p.fallback.sites === 1 ? "" : "s"}, {formatCount(p.fallback.eventsPerPeriod)} events a month,{" "}
              {p.fallback.retentionDays} days of history.
            </p>
            {p.featuresLost.length > 0 && (
              <p>
                <span className="text-text-secondary">You lose: </span>
                {p.featuresLost.map((f) => f.label).join(", ")}.
              </p>
            )}
            {p.sitesThatWouldGoInactive.length > 0 && (
              <p className="rounded-md border border-warning/50 bg-warning/5 px-3 py-2 text-text-secondary">
                {p.sitesThatWouldGoInactive.map((s) => s.domain).join(", ")} would stop collecting new data. History is kept;
                you can choose which site stays active.
              </p>
            )}
            <p className="text-text-secondary">All of your analytics data is kept. You can resume any time before the end date.</p>
          </div>
        )}

        {cancel.error && <p className="text-sm text-danger">{(cancel.error as { message?: string }).message}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={cancel.isPending}>
            Keep my plan
          </Button>
          <Button variant="destructive" onClick={() => cancel.mutate(undefined, { onSuccess: onClose })} disabled={!p || cancel.isPending}>
            {cancel.isPending ? "Cancelling..." : "Cancel at period end"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
