import { useState } from "react";
import { KeyRound, TriangleAlert } from "lucide-react";

import { API_BASE_URL } from "../config/env";
import { Button } from "../shared/components/ui/button";
import { Card, CardContent } from "../shared/components/ui/card";
import { Field } from "../shared/components/Field";
import FeatureGate from "../features/billing/components/FeatureGate";
import { CopyButton } from "../features/websites/components/TrackingSnippet";
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from "../features/api-keys/hooks/useApiKeys";
import type { ApiKey, CreatedApiKey } from "../features/api-keys/types";

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Never";

const apiRoot = `${API_BASE_URL}/api/v1`;

/**
 * Personal API keys. Read-only bearer tokens for the same endpoints the
 * dashboard calls. Creating one is plan-gated; the list and revoke are not, so
 * an account that has downgraded can still clean up. The token is shown once,
 * right after creation, and never again.
 */
export default function ApiKeysPage() {
  const keys = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();

  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(trimmed, {
      onSuccess: (result) => {
        setCreated(result);
        setName("");
      },
    });
  };

  const active = (keys.data ?? []).filter((k) => !k.revokedAt);
  const revoked = (keys.data ?? []).filter((k) => k.revokedAt);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold">API keys</h1>
        <p className="text-sm text-text-muted">
          Read your stats from scripts and spreadsheets. Keys can read everything you can see in the dashboard
          and change nothing.
        </p>
      </div>

      {created && (
        <Card className="border-brand">
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <TriangleAlert size={18} className="mt-0.5 shrink-0 text-warning" />
              <div>
                <h2 className="font-medium">Copy your new key now</h2>
                <p className="text-sm text-text-muted">
                  This is the only time <strong>{created.key.name}</strong> is shown. Store it somewhere safe; if you
                  lose it, revoke it and create another.
                </p>
              </div>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-[13px]">
              {created.token}
            </pre>
            <div className="flex gap-2">
              <CopyButton value={created.token} label="Copy key" />
              <Button variant="outline" onClick={() => setCreated(null)}>
                Done
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <FeatureGate
        feature="api_access"
        title="API access is a paid feature"
        description="Upgrade to create API keys and read your analytics from scripts, spreadsheets and other tools."
      >
        <Card>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Field
                  label="Key name"
                  placeholder="e.g. Weekly report script"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  helperText="A label so you can tell keys apart. It does not affect what the key can do."
                />
              </div>
              <Button type="submit" disabled={!name.trim() || create.isPending}>
                <KeyRound size={15} />
                {create.isPending ? "Creating..." : "Create key"}
              </Button>
            </form>
            {create.error && (
              <p className="mt-2 text-sm text-danger">{(create.error as { message?: string }).message}</p>
            )}
          </CardContent>
        </Card>
      </FeatureGate>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="font-medium">Your keys</h2>

          {keys.isLoading && <div className="h-16 animate-pulse rounded-lg bg-black/5 dark:bg-white/10" />}
          {keys.error && <p className="text-sm text-danger">{(keys.error as { message?: string }).message}</p>}

          {keys.data && active.length === 0 && (
            <p className="text-sm text-text-muted">No active keys. Create one above to get started.</p>
          )}

          {active.length > 0 && (
            <ul className="divide-y divide-border">
              {active.map((key) => (
                <KeyRow
                  key={key.id}
                  apiKey={key}
                  confirming={confirming === key.id}
                  busy={revoke.isPending && revoke.variables === key.id}
                  onRevoke={() => {
                    if (confirming !== key.id) {
                      setConfirming(key.id);
                      return;
                    }
                    revoke.mutate(key.id, { onSettled: () => setConfirming(null) });
                  }}
                  onCancel={() => setConfirming(null)}
                />
              ))}
            </ul>
          )}

          {revoked.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-text-muted">
                {revoked.length} revoked key{revoked.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-2 divide-y divide-border">
                {revoked.map((key) => (
                  <li key={key.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-text-muted">
                    <span className="font-medium line-through">{key.name}</span>
                    <span className="font-mono text-xs">{key.keyPrefix}...</span>
                    <span className="text-xs">Revoked {shortDate(key.revokedAt)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="font-medium">Using a key</h2>
          <p className="text-sm text-text-secondary">
            Send the key as a bearer token. Every read endpoint the dashboard uses is available; the base URL is{" "}
            <code className="rounded bg-black/[0.05] px-1 py-0.5 font-mono text-[12.5px] dark:bg-white/[0.08]">{apiRoot}</code>.
            Requests are limited to 300 a minute per address. Writes return 403.
          </p>
          <pre className="overflow-x-auto rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-[12.5px] leading-relaxed">
            {`# Your websites (use the id in the calls below)
curl -H "Authorization: Bearer $WEBYZ_KEY" \\
  ${apiRoot}/websites

# Headline numbers for the last 7 days
curl -H "Authorization: Bearer $WEBYZ_KEY" \\
  "${apiRoot}/SITE_ID/top-stats?period=last_7_days"

# Any breakdown, paginated: browsers, countries, source, top-pages, ...
curl -H "Authorization: Bearer $WEBYZ_KEY" \\
  "${apiRoot}/SITE_ID/browsers?period=last_28_days&detailed=true&limit=100"

# The same data as CSV
curl -H "Authorization: Bearer $WEBYZ_KEY" -o browsers.csv \\
  "${apiRoot}/SITE_ID/export?period=last_28_days&dataset=browsers"`}
          </pre>
          <p className="text-xs text-text-muted">
            Periods: today, yesterday, last_7_days, last_28_days, last_91_days, this_month, last_month, this_year,
            last_12_months, all_time, or custom with from and to as YYYY-MM-DD. Add f.browser, f.country, f.page and so
            on to filter, exactly as the dashboard URL does.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function KeyRow({
  apiKey,
  confirming,
  busy,
  onRevoke,
  onCancel,
}: {
  apiKey: ApiKey;
  confirming: boolean;
  busy: boolean;
  onRevoke: () => void;
  onCancel: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate font-medium">{apiKey.name}</p>
        <p className="text-xs text-text-muted">
          <span className="font-mono">{apiKey.keyPrefix}...</span>
          <span aria-hidden> · </span>
          Created {shortDate(apiKey.createdAt)}
          <span aria-hidden> · </span>
          Last used {shortDate(apiKey.lastUsedAt)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {confirming && (
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            Keep
          </Button>
        )}
        <Button variant={confirming ? "destructive" : "outline"} size="sm" onClick={onRevoke} disabled={busy}>
          {busy ? "Revoking..." : confirming ? "Confirm revoke" : "Revoke"}
        </Button>
      </div>
    </li>
  );
}
