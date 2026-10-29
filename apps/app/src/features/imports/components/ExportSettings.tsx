import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "../../../shared/components/ui/button";
import { API_BASE_URL, MARKETING_URL } from "../../../config/env";
import { useDeleteExport, useRequestExport, useSiteExport } from "../hooks/useSiteExport";
import { SettingsCard } from "./ImportSettings";

const GUIDE = MARKETING_URL
  ? `${MARKETING_URL}/docs/importing#export`
  : "https://github.com/webyz-org/webyz/blob/main/docs/importing.md#export";

/** "in 7 days", "in 1 day", "in 5 hours", from now to an ISO time. */
const expiresIn = (iso: string) => {
  const ms = Date.parse(iso) - Date.now();
  const days = Math.round(ms / 86_400_000);
  if (days >= 1) return `in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  return `in ${hours} hour${hours === 1 ? "" : "s"}`;
};

const formatSize = (bytes: number | null) =>
  bytes === null ? "" : bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;

/**
 * "Export data", Plausible's flow: Export to CSV prepares a zip of the site's
 * tracked history in the import format; while it builds this card polls; then
 * the file is listed to download, with a delete and its expiry. The person
 * who asked is also emailed when it is ready.
 */
export default function ExportSettings({ siteId }: { siteId: string; domain: string; timezone: string }) {
  const current = useSiteExport(siteId);
  const request = useRequestExport(siteId);
  const remove = useDeleteExport(siteId);
  const [confirming, setConfirming] = useState(false);
  const item = current.data;

  const exportButton = (label: string) => (
    <Button
      className="bg-brand text-white hover:bg-brand/90"
      onClick={() => request.mutate()}
      disabled={request.isPending}
    >
      {request.isPending ? "Starting..." : label}
    </Button>
  );

  return (
    <SettingsCard title="Export data" description="Export all your data into CSV format." infoHref={GUIDE}>
      <div className="-mt-2 border-b border-border pb-3">
        <h3 className="font-medium">Export</h3>
      </div>

      {current.isLoading ? (
        <div className="h-6 w-56 animate-pulse rounded bg-black/5 dark:bg-white/10" />
      ) : !item ? (
        <div className="space-y-3">
          <p className="text-sm text-text-muted">
            Prepare a zip of this site&rsquo;s tracked data, one CSV per report in the format Import from CSV and
            Plausible read. You will get an email when it is ready, and it can be downloaded here for 7 days.
          </p>
          {exportButton("Export to CSV")}
        </div>
      ) : item.status === "running" ? (
        <p className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          Preparing {item.filename}. This page updates when it is ready, and you will get an email too.
        </p>
      ) : item.status === "failed" ? (
        <div className="space-y-3">
          <p className="text-sm text-danger">{item.error ?? "The export failed."}</p>
          {exportButton("Try again")}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            {/* A plain link: the download streams to disk and carries the session cookie. */}
            <a
              href={`${API_BASE_URL}/api/v1/websites/${siteId}/exports/${item.id}/download`}
              className="truncate text-brand hover:underline"
            >
              {item.filename}
            </a>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-text-muted">{formatSize(item.size_bytes)}</span>
              {confirming ? (
                <>
                  <Button variant="destructive" size="sm" onClick={() => remove.mutate(item.id)} disabled={remove.isPending}>
                    {remove.isPending ? "Deleting..." : "Delete"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
                    Keep
                  </Button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="text-danger hover:opacity-80"
                  aria-label="Delete export"
                  title="Delete export"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          </div>
          {item.expires_at && (
            <p className="text-sm">
              Note: this file will expire{" "}
              <span className="underline decoration-dashed underline-offset-4" title={new Date(item.expires_at).toLocaleString()}>
                {expiresIn(item.expires_at)}
              </span>
              .
            </p>
          )}
          <div className="pt-1">{exportButton("Export again")}</div>
        </div>
      )}
      {request.error && <p className="text-sm text-danger">{(request.error as { message?: string }).message}</p>}
    </SettingsCard>
  );
}
