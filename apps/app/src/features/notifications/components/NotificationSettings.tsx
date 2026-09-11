import { useState } from "react";

import { Button } from "../../../shared/components/ui/button";
import { Card, CardContent } from "../../../shared/components/ui/card";
import { Field } from "../../../shared/components/Field";
import type { ApiError } from "../../../lib/axios";
import { useAuth } from "../../auth/hooks/useAuth";
import type { Website } from "../../websites/types";
import { useNotificationMutations, useNotifications } from "../hooks/useNotifications";
import type { EmailReport, ReportFrequency, TrafficAlert } from "../types";

/**
 * Per-site email notifications: weekly and monthly summary reports, and the
 * traffic spike alert. The server validates recipients and thresholds; the
 * form only splits the comma-separated input and shows what came back.
 */
export default function NotificationSettings({ site }: { site: Website }) {
  const notifications = useNotifications(site.id);
  const { user } = useAuth();
  const defaultRecipient = user?.email ?? "";

  if (notifications.isLoading) {
    return <div className="h-40 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />;
  }

  const reports = notifications.data?.reports ?? [];
  const byFrequency = (f: ReportFrequency) =>
    reports.find((r) => r.frequency === f.toUpperCase()) ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-5">
          <div>
            <h2 className="font-medium">Email reports</h2>
            <p className="text-sm text-text-muted">
              A summary of visitors, pages, sources and goals for the period just
              ended. Weekly reports go out Monday morning, monthly reports on the
              1st, both at 09:00 in the site's timezone ({site.timezone}).
            </p>
          </div>

          <ReportRow
            siteId={site.id}
            frequency="weekly"
            title="Weekly report"
            description="Monday to Sunday of the previous week."
            report={byFrequency("weekly")}
            defaultRecipient={defaultRecipient}
          />
          <div className="border-t border-border" />
          <ReportRow
            siteId={site.id}
            frequency="monthly"
            title="Monthly report"
            description="The previous calendar month."
            report={byFrequency("monthly")}
            defaultRecipient={defaultRecipient}
          />
        </CardContent>
      </Card>

      <AlertCard
        siteId={site.id}
        alert={notifications.data?.alert ?? null}
        defaultRecipient={defaultRecipient}
      />
    </div>
  );
}

const splitRecipients = (value: string) =>
  value
    .split(/[,\s;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const errorMessage = (err: unknown) =>
  (err as ApiError | undefined)?.message ?? "Something went wrong";

function ReportRow({
  siteId,
  frequency,
  title,
  description,
  report,
  defaultRecipient,
}: {
  siteId: string;
  frequency: ReportFrequency;
  title: string;
  description: string;
  report: EmailReport | null;
  defaultRecipient: string;
}) {
  const { upsertReport, deleteReport, testReport } = useNotificationMutations(siteId);
  const enabled = Boolean(report);

  // `null` means untouched: the field shows what the server holds, so a
  // refetch after a save needs no effect to resync the input.
  const saved = report?.recipients.join(", ") ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const recipients = draft ?? saved;
  const dirty = enabled && recipients.trim() !== saved;
  const setRecipients = (value: string) => setDraft(value === saved ? null : value);

  const enable = () =>
    upsertReport.mutate(
      { frequency, recipients: [defaultRecipient] },
      { onSuccess: () => setDraft(null) },
    );

  const save = () =>
    upsertReport.mutate(
      { frequency, recipients: splitRecipients(recipients) },
      { onSuccess: () => setDraft(null) },
    );

  const isBusy = upsertReport.isPending || deleteReport.isPending;
  const showError = upsertReport.variables?.frequency === frequency && upsertReport.isError;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-text-muted">{description}</p>
        </div>
        {enabled ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => deleteReport.mutate(frequency)}
            disabled={isBusy}
          >
            {deleteReport.isPending ? "Turning off..." : "Turn off"}
          </Button>
        ) : (
          <Button size="sm" onClick={enable} disabled={isBusy || !defaultRecipient}>
            {upsertReport.isPending ? "Turning on..." : "Turn on"}
          </Button>
        )}
      </div>

      {enabled && (
        <>
          <Field
            label="Recipients"
            placeholder="you@example.com, team@example.com"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            error={showError}
            helperText={
              showError
                ? errorMessage(upsertReport.error)
                : "Up to 10 addresses, separated by commas."
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save} disabled={!dirty || isBusy}>
              {upsertReport.isPending ? "Saving..." : "Save recipients"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => testReport.mutate(frequency)}
              disabled={testReport.isPending}
            >
              {testReport.isPending ? "Sending..." : "Send test"}
            </Button>
            {testReport.isSuccess && testReport.variables === frequency && (
              <span className="text-xs text-text-muted">
                {testReport.data.sent
                  ? `Sent ${testReport.data.period.label} to ${testReport.data.to}`
                  : "Could not send. Check the server's email configuration."}
              </span>
            )}
            {testReport.isError && testReport.variables === frequency && (
              <span className="text-xs text-danger">{errorMessage(testReport.error)}</span>
            )}
          </div>
          {report?.lastPeriodEnd && (
            <p className="text-xs text-text-muted">
              Last sent for the period ending{" "}
              {new Date(report.lastPeriodEnd).toLocaleDateString()}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function AlertCard({
  siteId,
  alert,
  defaultRecipient,
}: {
  siteId: string;
  alert: TrafficAlert | null;
  defaultRecipient: string;
}) {
  const { upsertAlert, deleteAlert } = useNotificationMutations(siteId);
  const enabled = Boolean(alert);

  // Same draft-or-server pattern as the report rows: `null` shows the saved
  // value (or the defaults for a new alert) with no effect to resync.
  const savedThreshold = alert ? String(alert.threshold) : "100";
  const savedRecipients = alert?.recipients.join(", ") ?? defaultRecipient;
  const [thresholdDraft, setThresholdDraft] = useState<string | null>(null);
  const [recipientsDraft, setRecipientsDraft] = useState<string | null>(null);
  const threshold = thresholdDraft ?? savedThreshold;
  const recipients = recipientsDraft ?? savedRecipients;
  const setThreshold = (v: string) => setThresholdDraft(v === savedThreshold ? null : v);
  const setRecipients = (v: string) => setRecipientsDraft(v === savedRecipients ? null : v);

  const dirty = enabled && (thresholdDraft !== null || recipientsDraft !== null);

  const submit = () =>
    upsertAlert.mutate(
      { threshold: Number(threshold), recipients: splitRecipients(recipients) },
      {
        onSuccess: () => {
          setThresholdDraft(null);
          setRecipientsDraft(null);
        },
      },
    );

  const isBusy = upsertAlert.isPending || deleteAlert.isPending;
  const thresholdValid = /^\d+$/.test(threshold) && Number(threshold) >= 1 && Number(threshold) <= 1_000_000;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Traffic spike alert</h2>
            <p className="text-sm text-text-muted">
              One email when the visitors on the site right now reach the
              threshold, then nothing for 12 hours so a sustained spike is a
              single alert.
            </p>
          </div>
          {enabled && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => deleteAlert.mutate()}
              disabled={isBusy}
            >
              {deleteAlert.isPending ? "Turning off..." : "Turn off"}
            </Button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <Field
            label="Visitors right now"
            type="number"
            min={1}
            max={1_000_000}
            inputMode="numeric"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            error={threshold !== "" && !thresholdValid}
            helperText={threshold !== "" && !thresholdValid ? "1 to 1,000,000" : undefined}
          />
          <Field
            label="Recipients"
            placeholder={defaultRecipient || "you@example.com"}
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            error={upsertAlert.isError}
            helperText={
              upsertAlert.isError
                ? errorMessage(upsertAlert.error)
                : "Up to 10 addresses, separated by commas."
            }
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={submit}
            disabled={isBusy || !thresholdValid || (enabled && !dirty) || !recipients.trim()}
          >
            {upsertAlert.isPending ? "Saving..." : enabled ? "Save" : "Turn on"}
          </Button>
          {alert?.lastTriggeredAt && (
            <span className="text-xs text-text-muted">
              Last alert {new Date(alert.lastTriggeredAt).toLocaleString()}.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
