import { useState } from "react";
import { Link, useSearchParams } from "react-router";

import { Button } from "../../../shared/components/ui/button";
import { Card, CardContent } from "../../../shared/components/ui/card";
import { SelectField } from "../../../shared/components/Field";
import {
  useConnectGsc,
  useDisconnectGsc,
  useGscProperties,
  useGscStatus,
  useSelectGscProperty,
} from "../hooks/useSearchConsole";

/**
 * "Google Search Console" card for the site settings page: connect via Google
 * OAuth, pick which GSC property feeds this site, disconnect. The OAuth
 * callback lands back here with ?gsc=connected or ?gsc=error.
 */
export default function SearchConsoleSettings({
  siteId,
  domain,
}: {
  siteId: string;
  domain: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const callbackResult = searchParams.get("gsc"); // "connected" | "error" | null

  const status = useGscStatus(siteId);
  const connect = useConnectGsc(siteId);
  const disconnect = useDisconnectGsc(siteId);
  const selectProperty = useSelectGscProperty(siteId);

  const connected = Boolean(status.data?.connected);
  // The property list needs a Google round trip; only fetch while connected.
  const properties = useGscProperties(siteId, connected);

  const [pendingProperty, setPendingProperty] = useState("");

  const dismissBanner = () => {
    const params = new URLSearchParams(searchParams);
    params.delete("gsc");
    setSearchParams(params, { replace: true });
  };

  // Suggest the properties that plausibly belong to this site's domain first.
  const matchesDomain = (siteUrl: string) =>
    siteUrl === `sc-domain:${domain}` || siteUrl.includes(`//${domain}`) ||
    siteUrl.includes(`//www.${domain}`);
  const sortedProperties = [...(properties.data ?? [])].sort(
    (a, b) => Number(matchesDomain(b.siteUrl)) - Number(matchesDomain(a.siteUrl)),
  );

  const selectedProperty = pendingProperty || status.data?.property || "";

  return (
    <Card>
      <CardContent className="space-y-3">
        <div>
          <h2 className="font-medium">Google Search Console</h2>
          <p className="text-sm text-text-muted">
            See the search terms, clicks, impressions and rankings Google
            reports for {domain}. Data is read-only and never stored beyond a
            short cache.
          </p>
        </div>

        {callbackResult === "connected" && (
          <div className="flex items-center justify-between rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
            Google account connected. Pick a property below to finish.
            <button onClick={dismissBanner} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}
        {callbackResult === "error" && (
          <div className="flex items-center justify-between rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            Connecting to Google failed. Try again.
            <button onClick={dismissBanner} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        {status.isLoading ? (
          <div className="h-9 w-56 animate-pulse rounded bg-black/5 dark:bg-white/10" />
        ) : !status.data?.configured ? (
          <p className="text-sm text-text-muted">
            Not available: this server has no Google OAuth credentials
            configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
          </p>
        ) : !connected ? (
          <Button
            onClick={() => connect.mutate()}
            disabled={connect.isPending}
          >
            {connect.isPending ? "Redirecting..." : "Connect Search Console"}
          </Button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              Connected
              {status.data.google_email ? (
                <>
                  {" "}as{" "}
                  <span className="font-medium">{status.data.google_email}</span>
                </>
              ) : null}
              .
            </p>

            {properties.isError ? (
              <div className="space-y-2">
                <p className="text-sm text-danger">
                  Could not list your Search Console properties. Access may
                  have been revoked; reconnect to fix it.
                </p>
                <Button
                  variant="outline"
                  onClick={() => connect.mutate()}
                  disabled={connect.isPending}
                >
                  Reconnect
                </Button>
              </div>
            ) : (
              <>
                <SelectField
                  label="Search Console property"
                  value={selectedProperty}
                  onChange={(e) => setPendingProperty(e.target.value)}
                  helperText={
                    properties.isLoading
                      ? "Loading your properties from Google..."
                      : sortedProperties.length
                        ? "Domain properties (sc-domain:) cover every protocol and subdomain."
                        : `No properties found. Verify ${domain} in Search Console first.`
                  }
                >
                  <option value="" disabled>
                    Select a property
                  </option>
                  {sortedProperties.map((p) => (
                    <option key={p.siteUrl} value={p.siteUrl}>
                      {p.siteUrl}
                      {matchesDomain(p.siteUrl) ? "  (matches this site)" : ""}
                    </option>
                  ))}
                </SelectField>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => selectProperty.mutate(selectedProperty)}
                    disabled={
                      !selectedProperty ||
                      selectedProperty === status.data.property ||
                      selectProperty.isPending
                    }
                  >
                    {selectProperty.isPending ? "Saving..." : "Save property"}
                  </Button>

                  {status.data.property && (
                    <Link
                      to={`/sites/${domain}/search`}
                      className="text-sm text-primary hover:underline"
                    >
                      Open search report
                    </Link>
                  )}

                  {selectProperty.isSuccess && (
                    <span className="text-sm text-success">Saved</span>
                  )}
                  {selectProperty.error && (
                    <span className="text-sm text-danger">
                      {(selectProperty.error as { message?: string }).message}
                    </span>
                  )}
                </div>
              </>
            )}

            <Button
              variant="outline"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? "Disconnecting..." : "Disconnect"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
