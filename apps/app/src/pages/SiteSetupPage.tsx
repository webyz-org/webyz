import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { CheckCircle2 } from "lucide-react";

import { Card, CardContent } from "../shared/components/ui/card";
import { Button } from "../shared/components/ui/button";
import TrackingSnippet from "../features/websites/components/TrackingSnippet";
import {
  useInstallStatus,
  useSiteByDomain,
} from "../features/websites/hooks/useWebsite";

/**
 * Post-create onboarding: show the snippet and hold here until the first
 * event arrives, then move on to the dashboard (Plausible/Umami style).
 */
export default function SiteSetupPage() {
  const { domain } = useParams<{ domain: string }>();
  const navigate = useNavigate();
  const { site, isLoading, notFound } = useSiteByDomain(domain);

  const status = useInstallStatus(site?.id);
  const verified = Boolean(status.data?.hasEvents);

  // Small pause so the success state registers before the dashboard appears.
  useEffect(() => {
    if (!verified) return;
    const t = setTimeout(() => navigate(`/sites/${domain}`), 1500);
    return () => clearTimeout(t);
  }, [verified, domain, navigate]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <div className="h-40 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />
      </div>
    );
  }

  if (notFound || !site) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 text-center">
        <h1 className="text-lg font-semibold">Site not found</h1>
        <Link to="/sites" className="mt-3 inline-block text-sm text-primary hover:underline">
          Back to sites
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold">Install Webyz on {site.domain}</h1>
        <p className="mt-1 text-sm text-text-muted">
          Paste this snippet into the &lt;head&gt; of your site, then open any
          page on {site.domain}. This screen moves on by itself once the first
          pageview arrives.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="font-medium">Tracking snippet</h2>
          <TrackingSnippet siteId={site.id} />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {verified ? (
            <div className="flex items-center gap-3">
              <CheckCircle2 size={20} className="shrink-0 text-success" />
              <div>
                <p className="font-medium">First pageview received</p>
                <p className="text-sm text-text-muted">
                  Taking you to the dashboard...
                </p>
              </div>
              <Button className="ml-auto" onClick={() => navigate(`/sites/${domain}`)}>
                Go to dashboard
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
              </span>
              <div>
                <p className="font-medium">Waiting for the first pageview</p>
                <p className="text-sm text-text-muted">
                  Checking every few seconds. Visit your site in another tab to
                  send one.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {!verified && (
        <p className="text-sm text-text-muted">
          Not installing right now?{" "}
          <Link to="/sites" className="text-primary hover:underline">
            I'll do this later
          </Link>{" "}
          - the snippet stays available in the site's settings.
        </p>
      )}
    </div>
  );
}
