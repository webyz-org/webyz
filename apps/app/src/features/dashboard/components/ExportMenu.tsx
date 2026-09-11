import { useState } from "react";
import { Link } from "react-router";
import { Download, Loader2, Lock } from "lucide-react";

import { useEntitlements } from "../../billing/hooks/useEntitlements";
import { EXPORT_GROUPS, downloadExport, type AnalyticsScope } from "../api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../shared/components/ui/dropdown-menu";

/**
 * CSV export of the current view: same site, period and filters as the cards
 * on the page. One file per dataset, grouped the way the dashboard groups
 * them. Plan-gated: the API refuses with FEATURE_NOT_AVAILABLE regardless,
 * this only replaces the menu with an upgrade hint when the plan lacks it.
 */
export default function ExportMenu({ scope }: { scope: AnalyticsScope }) {
  const { entitlements } = useEntitlements();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (dataset: string) => {
    setBusy(dataset);
    setError(null);
    try {
      await downloadExport(scope, dataset);
    } catch (err) {
      const message = (err as { message?: string }).message;
      setError(message && message !== "Something went wrong" ? message : "Export failed. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const allowed = entitlements?.exports ?? false;

  return (
    <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Export CSV"
            title="Export CSV"
            disabled={busy !== null}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition-colors duration-150 hover:border-border-strong hover:bg-accent/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs font-medium text-text-muted">
            Export as CSV
          </DropdownMenuLabel>

          {!allowed ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/settings/billing">
                  <Lock size={14} />
                  Upgrade to export data
                </Link>
              </DropdownMenuItem>
            </>
          ) : (
            EXPORT_GROUPS.map((group) =>
              group.items.length === 1 ? (
                <DropdownMenuItem key={group.label} onClick={() => void run(group.items[0].key)}>
                  {group.items[0].label}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuSub key={group.label}>
                  <DropdownMenuSubTrigger>{group.label}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-48">
                    {group.items.map((item) => (
                      <DropdownMenuItem key={item.key} onClick={() => void run(item.key)}>
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ),
            )
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {error && (
        <p
          role="alert"
          className="absolute right-0 top-full z-10 mt-1 w-64 rounded-md border border-danger/40 bg-surface px-3 py-2 text-[12px] text-danger shadow-sm"
        >
          {error}
        </p>
      )}
    </div>
  );
}
