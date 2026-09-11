import { Link } from "react-router";
import { Globe, Plus } from "lucide-react";

import SiteRow from "../features/websites/components/SiteRow";
import { useWebsites } from "../features/websites/hooks/useWebsite";
import { useAuth } from "../features/auth/hooks/useAuth";
import { Button } from "../shared/components/ui/button";

// Rotating pastel tiles for the site initial, so a list of rows is not a
// column of identical marks.
const TILE_TONES = [
  "bg-primary-soft text-brand-ink",
  "bg-green-soft text-[#0a7a4d]",
  "bg-lilac-soft text-[#7a2f86]",
  "bg-sun-soft text-[#8a6100]",
];

export default function WebsitesPage() {
  const { data: websites, isLoading, error } = useWebsites();
  const { user } = useAuth();

  const firstName = user?.name?.split(" ")[0];

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-12 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-6 pt-6">
        <div>
          <h1 className="text-2xl font-bold leading-none tracking-tight text-text-primary">
            {firstName ? `Hi, ${firstName}` : "Your websites"}
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            {websites?.length
              ? `${websites.length} website${websites.length === 1 ? "" : "s"} tracked · numbers from the last 7 days`
              : "Add a site to get a tracking snippet."}
          </p>
        </div>

        <Link to="/sites/add">
          <Button>
            <Plus size={16} />
            Add website
          </Button>
        </Link>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-[104px] animate-pulse rounded-xl border border-border bg-black/[0.03] dark:bg-white/[0.04]"
            />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-danger">
          {(error as { message?: string }).message ?? "Could not load websites"}
        </p>
      )}

      {!isLoading && websites?.length === 0 && (
        <div className="rounded-xl border border-border bg-surface px-6 py-14 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-brand-ink">
            <Globe size={22} />
          </span>
          <h2 className="mt-4 text-xl font-bold">No websites yet</h2>
          <p className="mt-1 text-sm text-text-muted">
            Add your first site to get a tracking snippet.
          </p>
          <Link to="/sites/add" className="mt-5 inline-block">
            <Button>Add website</Button>
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {websites?.map((site, index) => (
          <SiteRow
            key={site.id}
            site={site}
            tone={TILE_TONES[index % TILE_TONES.length]}
          />
        ))}
      </div>
    </div>
  );
}
