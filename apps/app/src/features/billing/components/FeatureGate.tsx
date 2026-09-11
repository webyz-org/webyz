import type { ReactNode } from "react";
import { Link } from "react-router";
import { Lock } from "lucide-react";

import { useEntitlements, type FeatureKey } from "../hooks/useEntitlements";

/**
 * Renders its children only when the account's plan includes `feature`;
 * otherwise an upgrade notice. Purely a courtesy: the API rejects the same
 * requests with 403 FEATURE_NOT_AVAILABLE whether or not this component is
 * in the way. While the plan is still loading nothing is shown, so a page
 * never flashes a feature it is about to take away.
 */
export default function FeatureGate({
  feature,
  title,
  description,
  children,
}: {
  feature: FeatureKey;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { entitlements, planName, isLoading } = useEntitlements();

  if (isLoading || !entitlements) {
    return <div className="h-40 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />;
  }

  if (entitlements[feature]) return <>{children}</>;

  return <UpgradeNotice title={title} description={description} planName={planName} />;
}

export function UpgradeNotice({
  title,
  description,
  planName,
}: {
  title: string;
  description: string;
  planName: string | null;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-10 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-brand-ink">
        <Lock size={18} aria-hidden />
      </div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">
        {description}
        {planName ? ` It is not included in the ${planName} plan.` : ""}
      </p>
      <Link
        to="/settings/billing"
        className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        See plans
      </Link>
    </div>
  );
}
