import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Check, FilePlus2, FileText, Info, Trash2 } from "lucide-react";

import { Button } from "../../../shared/components/ui/button";
import { Card, CardContent } from "../../../shared/components/ui/card";
import { Field, SelectField } from "../../../shared/components/Field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/ui/dialog";
import { MARKETING_URL } from "../../../config/env";
import {
  useConnectGa4,
  useDeleteImport,
  useDiscardConnection,
  useImportConnection,
  useImports,
  useStartImport,
} from "../hooks/useImports";
import { useCsvUpload, type UploadState } from "../hooks/useCsvUpload";
import { readExport, type ExportFile } from "../csvFiles";
import type { SiteImport } from "../types";

/** Imports a site may hold at once; the API enforces the same number. */
const MAX_IMPORTS = 5;

/** The importing guide: the marketing site's docs, or the copy on GitHub when self-hosted. */
const GUIDE = MARKETING_URL
  ? `${MARKETING_URL}/docs/importing`
  : "https://github.com/webyz-org/webyz/blob/main/docs/importing.md";
const FORMAT_GUIDE = `${GUIDE}#csv-format`;

/** Google Analytics' bar mark, for the import button (nominative use, as Plausible does). */
export function GoogleAnalyticsMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="15.5" y="2" width="6" height="20" rx="3" fill="#F9AB00" />
      <rect x="9" y="9" width="6" height="13" rx="3" fill="#E37400" />
      <circle cx="5.5" cy="19" r="3" fill="#E37400" />
    </svg>
  );
}

/** A settings card with Plausible's header: title, optional description, info link, rule. */
export function SettingsCard({
  title,
  description,
  infoHref,
  children,
}: {
  title: string;
  description?: string;
  infoHref: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="space-y-0 p-0">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 className="text-lg font-medium">{title}</h2>
            {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
          </div>
          <a
            href={infoHref}
            target="_blank"
            rel="noreferrer"
            className="mt-1 shrink-0 text-brand hover:opacity-80"
            aria-label={`About ${title.toLowerCase()}`}
          >
            <Info size={20} />
          </a>
        </div>
        <div className="space-y-4 px-6 py-6">{children}</div>
      </CardContent>
    </Card>
  );
}

/**
 * "Import data" in site settings, laid out like Plausible's: an empty state
 * with Import from Google Analytics and Import from CSV, each opening its
 * flow in a dialog, and once there are imports, the list above the buttons.
 * Google Analytics: connect, pick a property, the server runs the job and
 * the list polls it (the OAuth callback returns with ?ga4=connected or
 * ?ga4=error and reopens the dialog). CSV: Plausible's import format from any
 * tool, picked or dropped, uploaded by the browser. Up to MAX_IMPORTS
 * imports, as long as their dates do not overlap.
 */
export default function ImportSettings({ siteId }: { siteId: string; domain: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const callbackResult = searchParams.get("ga4");
  const [dialog, setDialog] = useState<"ga4" | "csv" | null>(callbackResult === "connected" ? "ga4" : null);

  const imports = useImports(siteId);
  // Held here, above the dialogs, so the upload survives them closing.
  const upload = useCsvUpload(siteId);
  const list = imports.data ?? [];
  const live = list.filter((i) => i.status !== "failed");
  const full = live.length >= MAX_IMPORTS;
  const busy = upload.state.phase === "uploading";

  const dismissBanner = () => {
    const params = new URLSearchParams(searchParams);
    params.delete("ga4");
    setSearchParams(params, { replace: true });
  };

  const buttons = (
    <div className="flex flex-wrap justify-center gap-3">
      <Button variant="outline" className="h-12 gap-2 px-5 text-base" onClick={() => setDialog("ga4")} disabled={full || busy}>
        Import from
        <GoogleAnalyticsMark className="size-5" />
        <span className="text-left text-[11px] leading-[1.1] text-text-muted">
          Google
          <br />
          Analytics
        </span>
      </Button>
      <Button
        className="h-12 bg-brand px-5 text-base text-white hover:bg-brand/90"
        onClick={() => setDialog("csv")}
        disabled={full || busy}
      >
        Import from CSV
      </Button>
    </div>
  );

  return (
    <SettingsCard title="Import data" infoHref={GUIDE}>
      {callbackResult === "connected" && (
        <Banner tone="success" onDismiss={dismissBanner}>
          Google account connected. Pick a property to import.
        </Banner>
      )}
      {callbackResult === "error" && (
        <Banner tone="danger" onDismiss={dismissBanner}>
          Connecting to Google failed. Try again.
        </Banner>
      )}
      {upload.state.phase === "error" && (
        <Banner tone="danger" onDismiss={upload.reset}>
          {upload.state.message}
          {upload.state.partial && " The partial import is listed below; delete it and try again."}
        </Banner>
      )}

      {imports.isLoading ? (
        <div className="mx-auto h-24 w-72 animate-pulse rounded bg-black/5 dark:bg-white/10" />
      ) : list.length === 0 && !busy ? (
        <div className="space-y-5 py-6 text-center">
          <div className="space-y-2">
            <h3 className="text-base font-medium">Import your first data</h3>
            <p className="mx-auto max-w-md text-sm text-text-muted">
              Import data from external sources. Up to {MAX_IMPORTS} imports are allowed at a time, as long as their
              dates do not overlap. Only days before Webyz began tracking this site are imported.
            </p>
          </div>
          {buttons}
        </div>
      ) : (
        <>
          {busy && <UploadProgress state={upload.state as Extract<UploadState, { phase: "uploading" }>} />}
          {list.map((item) => (
            <ImportStatusPanel key={item.id} siteId={siteId} item={item} />
          ))}
          <div className="space-y-2 pt-2">
            {buttons}
            <p className="text-center text-xs text-text-muted">
              {full
                ? `This site holds ${MAX_IMPORTS} imports, the most it can. Delete one to import again.`
                : `${live.length} of ${MAX_IMPORTS} imports used. A new import cannot overlap the dates of these.`}
            </p>
          </div>
        </>
      )}

      <Dialog open={dialog === "ga4"} onOpenChange={(open) => setDialog(open ? "ga4" : null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Import from Google Analytics</DialogTitle>
            <DialogDescription>
              Webyz reads your Google Analytics 4 property with read-only access, revoked as soon as the import ends.
            </DialogDescription>
          </DialogHeader>
          <NewImport siteId={siteId} onStarted={() => setDialog(null)} />
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "csv"} onOpenChange={(open) => setDialog(open ? "csv" : null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Import from CSV files</DialogTitle>
          </DialogHeader>
          <CsvImport
            onStart={(files, name) => {
              setDialog(null);
              return upload.run(files, name);
            }}
          />
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}

function Banner({
  tone,
  onDismiss,
  children,
}: {
  tone: "success" | "danger";
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const classes =
    tone === "success"
      ? "border-success/40 bg-success/10 text-success"
      : "border-danger/40 bg-danger/10 text-danger";
  return (
    <div className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${classes}`}>
      {children}
      <button onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}


function UploadProgress({ state }: { state: Extract<UploadState, { phase: "uploading" }> }) {
  const percent = state.total ? Math.min(100, Math.round((state.done / state.total) * 100)) : 0;
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <p className="text-sm font-medium">Uploading your CSV files, {percent}%</p>
      <div className="h-1.5 overflow-hidden rounded bg-black/5 dark:bg-white/10">
        <div className="h-full bg-brand transition-all" style={{ width: `${Math.max(percent, 3)}%` }} />
      </div>
      <p className="text-xs text-text-muted">
        {state.file ? `Sending ${state.file}. ` : ""}Keep this tab open until it finishes.
      </p>
    </div>
  );
}

/** Every report file, in the order Plausible lists them, and what it carries. */
const REPORTS: Array<{ report: string; label: string }> = [
  { report: "visitors", label: "Visitors, visits, pageviews, bounce rate and duration" },
  { report: "sources", label: "Sources, channels and UTM" },
  { report: "pages", label: "Pages, with scroll depth and time on page" },
  { report: "entry_pages", label: "Entry pages" },
  { report: "exit_pages", label: "Exit pages" },
  { report: "custom_events", label: "Custom events, outbound links and downloads" },
  { report: "locations", label: "Countries, regions and cities" },
  { report: "devices", label: "Devices" },
  { report: "browsers", label: "Browsers and versions" },
  { report: "operating_systems", label: "Operating systems and versions" },
  { report: "custom_props", label: "Custom properties (stored for later)" },
];

/**
 * Pick or drop CSV files in Plausible's import format, from Plausible's own
 * export or any other tool, or the zip they came in. Nothing is sent until
 * Confirm import.
 */
function CsvImport({ onStart }: { onStart: (files: ExportFile[], archiveName?: string) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ExportFile[]>([]);
  const [archive, setArchive] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const take = async (picked: File[]) => {
    setProblem(null);
    if (!picked.length) return;
    setReading(true);
    try {
      const { files: found, ignored } = await readExport(picked);
      // Adding files keeps the ones already chosen; the same report again replaces it.
      const merged = new Map(files.map((f) => [f.report, f]));
      for (const f of found) merged.set(f.report, f);
      setFiles([...merged.values()]);
      setArchive(picked.find((f) => /\.zip$/i.test(f.name))?.name ?? archive ?? picked[0].name);
      if (ignored.length) {
        setProblem(`Not import files, skipped: ${ignored.join(", ")}. Files are named imported_<report>_YYYYMMDD_YYYYMMDD.csv.`);
      }
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setReading(false);
    }
  };

  const byReport = new Map(files.map((f) => [f.report, f]));
  const hasVisitors = byReport.has("visitors");
  const starts = files.map((f) => f.start).sort();
  const ends = files.map((f) => f.end).sort();

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        Files follow{" "}
        <a href={FORMAT_GUIDE} target="_blank" rel="noreferrer" className="text-brand hover:underline">
          the CSV format guidelines
        </a>
        , the same format Plausible exports, so a Plausible export works as it is and any other tool can be converted
        to it. Pick several files at once, drop them here, or drop the zip they came in.
      </p>

      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void take([...e.dataTransfer.files]);
        }}
        className={
          "cursor-pointer space-y-1.5 rounded-md border border-dashed p-4 text-sm transition-colors " +
          (dragging ? "border-brand bg-primary-soft" : "border-border bg-black/[0.02] dark:bg-white/[0.03]")
        }
      >
        <p className="flex items-center gap-2 text-text-muted">
          <FilePlus2 size={16} aria-hidden />
          {reading ? "Reading..." : "(or drag and drop your CSVs, or the zip they came in, here)"}
        </p>
        <ul className="space-y-1 pt-1">
          {REPORTS.map(({ report, label }) => {
            const file = byReport.get(report);
            return (
              <li key={report} className="flex items-center gap-2" title={label}>
                {file ? (
                  <Check size={14} className="shrink-0 text-success" aria-hidden />
                ) : (
                  <FileText size={14} className="shrink-0 text-text-muted/60" aria-hidden />
                )}
                <span className={file ? "font-mono text-xs" : "font-mono text-xs text-text-muted/60"}>
                  {file ? file.name : `imported_${report}_YYYYMMDD_YYYYMMDD.csv`}
                </span>
              </li>
            );
          })}
        </ul>
        <input
          ref={input}
          type="file"
          accept=".csv,.zip"
          multiple
          className="hidden"
          onChange={(e) => {
            void take([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      {problem && <p className="text-sm text-danger">{problem}</p>}
      {files.length > 0 && !hasVisitors && (
        <p className="text-sm text-danger">
          Add the imported_visitors file: it carries the site totals, and without it the overview would show no
          imported traffic while the breakdowns do.
        </p>
      )}
      {files.length > 0 && (
        <p className="text-sm text-text-muted">
          {files.length} of {REPORTS.length} files, covering {formatDate(starts[0])} to {formatDate(ends[ends.length - 1])}.
          Missing files are fine; those reports just stay without history.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button
          className="flex-1 bg-brand text-white hover:bg-brand/90"
          onClick={() => void onStart(files, archive)}
          disabled={!hasVisitors || reading}
        >
          Confirm import
        </Button>
        {files.length > 0 && (
          <Button
            variant="outline"
            onClick={() => {
              setFiles([]);
              setArchive(undefined);
              setProblem(null);
            }}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

function NewImport({ siteId, onStarted }: { siteId: string; onStarted?: () => void }) {
  const connection = useImportConnection(siteId, true);
  const connect = useConnectGa4(siteId);
  const discard = useDiscardConnection(siteId);
  const start = useStartImport(siteId);

  const [propertyId, setPropertyId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  if (connection.isLoading) {
    return <div className="h-9 w-56 animate-pulse rounded bg-black/5 dark:bg-white/10" />;
  }

  if (connection.data && !connection.data.configured) {
    return (
      <p className="text-sm text-text-muted">
        Not available: this server has no Google OAuth credentials configured
        (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
      </p>
    );
  }

  if (connection.isError || !connection.data?.connected) {
    return (
      <div className="space-y-2">
        {connection.isError && (
          <p className="text-sm text-danger">
            {(connection.error as { message?: string }).message ?? "Google no longer accepts the connection."}
          </p>
        )}
        <Button
          onClick={() => connect.mutate()}
          disabled={connect.isPending}
        >
          {connect.isPending ? "Redirecting..." : "Connect Google Analytics"}
        </Button>
        <p className="text-xs text-text-muted">
          Asks Google for read-only access to your Analytics properties. The
          access is revoked as soon as the import finishes.
        </p>
      </div>
    );
  }

  const properties = connection.data.properties;
  const selected = propertyId || properties[0]?.id || "";

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Connected
        {connection.data.email ? (
          <>
            {" "}as <span className="font-medium">{connection.data.email}</span>
          </>
        ) : null}
        .
      </p>

      {properties.length === 0 ? (
        <p className="text-sm text-text-muted">
          This Google account has no Google Analytics 4 properties. Connect the
          account that owns the property instead.
        </p>
      ) : (
        <>
          <SelectField
            label="Google Analytics 4 property"
            value={selected}
            onChange={(e) => setPropertyId(e.target.value)}
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.account ? ` (${p.account})` : ""}
              </option>
            ))}
          </SelectField>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="From (optional)"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              helperText="Defaults to when the property was created."
            />
            <Field
              label="To (optional)"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              helperText="Never later than the day before Webyz began tracking."
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() =>
                start.mutate(
                  {
                    propertyId: selected,
                    ...(startDate ? { startDate } : {}),
                    ...(endDate ? { endDate } : {}),
                  },
                  { onSuccess: () => onStarted?.() },
                )
              }
              disabled={!selected || start.isPending}
            >
              {start.isPending ? "Starting..." : "Start import"}
            </Button>
            <Button variant="outline" onClick={() => discard.mutate()} disabled={discard.isPending}>
              Cancel
            </Button>
            {start.error && (
              <span className="text-sm text-danger">{(start.error as { message?: string }).message}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

function ImportStatusPanel({ siteId, item }: { siteId: string; item: SiteImport }) {
  const remove = useDeleteImport(siteId);
  const [confirming, setConfirming] = useState(false);
  const active = item.status === "pending" || item.status === "running";
  const percent = item.steps_total ? Math.round((item.steps_done / item.steps_total) * 100) : 0;

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {item.source === "csv" ? "CSV" : "Google Analytics 4"}:{" "}
            {item.property_name ?? item.property_id}
          </p>
          <p className="text-xs text-text-muted">
            {formatDate(item.start_date)} to {formatDate(item.end_date)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={
              item.status === "completed"
                ? "text-sm text-success"
                : item.status === "failed"
                  ? "text-sm text-danger"
                  : "text-sm text-text-muted"
            }
          >
            {item.status === "completed"
              ? "Imported"
              : item.status === "failed"
                ? "Failed"
                : item.status === "running"
                  ? `Importing, ${percent}%`
                  : item.source === "csv"
                    ? "Uploading"
                    : "Queued"}
          </span>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-danger hover:opacity-80"
            aria-label={active ? "Stop and delete import" : "Delete import"}
            title={active ? "Stop and delete import" : "Delete import"}
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {active && (
        <div className="h-1.5 overflow-hidden rounded bg-black/5 dark:bg-white/10">
          <div className="h-full bg-brand transition-all" style={{ width: `${Math.max(percent, 3)}%` }} />
        </div>
      )}

      {item.error && <p className="text-sm text-danger">{item.error}</p>}

      {item.status === "completed" && (
        <div className="space-y-2 text-sm text-text-muted">
          <p>
            {item.rows_imported.toLocaleString()} daily rows imported. The
            dashboard adds them to every report for those dates, including
            the Pages report. A filter keeps them when it and the report come
            from the same imported report (country and region, source and
            campaign); across two, imported data is left out and the
            dashboard says so.
          </p>
          {item.skipped.length > 0 && (
            <p>
              Google could not provide for this property: {item.skipped.join(", ")}.
            </p>
          )}
          <details>
            <summary className="cursor-pointer">Not imported, and why</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {item.not_imported.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {confirming && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-danger/5 p-2">
          <span className="text-sm">
            {active ? "Stop and delete this import?" : "Delete the imported data? Tracked data is not affected."}
          </span>
          <Button variant="destructive" size="sm" onClick={() => remove.mutate(item.id)} disabled={remove.isPending}>
            {remove.isPending ? "Deleting..." : "Delete"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </div>
      )}
    </div>
  );
}
