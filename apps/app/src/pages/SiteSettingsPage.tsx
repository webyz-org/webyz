import { Link, useParams, useSearchParams } from "react-router";
import {
  ArrowLeft,
  Bell,
  Eye,
  Filter,
  Puzzle,
  Rocket,
  Target,
  TriangleAlert,
  Users,
} from "lucide-react";

import GeneralSettings from "../features/websites/components/settings/GeneralSettings";
import VisibilitySettings from "../features/websites/components/settings/VisibilitySettings";
import DangerZoneSettings from "../features/websites/components/settings/DangerZoneSettings";
import GoalSettings from "../features/conversions/components/GoalSettings";
import FunnelSettings from "../features/conversions/components/FunnelSettings";
import SearchConsoleSettings from "../features/search-console/components/SearchConsoleSettings";
import FeatureGate from "../features/billing/components/FeatureGate";
import NotificationSettings from "../features/notifications/components/NotificationSettings";
import TeamSettings from "../features/team/components/TeamSettings";
import { useAuth } from "../features/auth/hooks/useAuth";
import { useSiteByDomain } from "../features/websites/hooks/useWebsite";

const SECTIONS = [
  { key: "general", label: "General", icon: Rocket },
  { key: "goals", label: "Goals", icon: Target },
  { key: "funnels", label: "Funnels", icon: Filter },
  { key: "integrations", label: "Integrations", icon: Puzzle },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "visibility", label: "Visibility", icon: Eye },
  { key: "people", label: "People", icon: Users },
  { key: "danger", label: "Danger zone", icon: TriangleAlert },
] as const;

/** Sections a member with view-only access may open. */
const VIEWER_SECTIONS: readonly SectionKey[] = ["people"];
/** Sections only the owner may open: deletion cannot be delegated. */
const OWNER_SECTIONS: readonly SectionKey[] = ["danger"];

type SectionKey = (typeof SECTIONS)[number]["key"];

/**
 * Site settings, sectioned Plausible-style: a sidebar of sections with one
 * content panel, each section a feature component. The section lives in the
 * URL so deep links work - the Search Console OAuth callback lands directly
 * on Integrations via ?section=integrations.
 */
export default function SiteSettingsPage() {
  const { domain } = useParams<{ domain: string }>();
  const { site, isLoading, notFound } = useSiteByDomain(domain);
  const { user } = useAuth();

  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get("section") as SectionKey | null;
  // A GSC callback without an explicit section still belongs on Integrations.
  const fallback: SectionKey = searchParams.get("gsc") ? "integrations" : "general";
  // Viewers manage nothing, so their only section is People; admins manage
  // everything but the site's existence.
  const role = site?.role ?? "owner";
  const visibleSections = SECTIONS.filter((s) =>
    role === "viewer"
      ? VIEWER_SECTIONS.includes(s.key)
      : role === "admin"
        ? !OWNER_SECTIONS.includes(s.key)
        : true,
  );
  const requested: SectionKey = SECTIONS.some((s) => s.key === sectionParam)
    ? (sectionParam as SectionKey)
    : fallback;
  const section: SectionKey = visibleSections.some((s) => s.key === requested)
    ? requested
    : visibleSections[0].key;

  const selectSection = (key: SectionKey) => {
    const params = new URLSearchParams(searchParams);
    if (key === "general") params.delete("section");
    else params.set("section", key);
    setSearchParams(params, { replace: true });
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 md:px-6 py-10">
        <div className="h-40 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />
      </div>
    );
  }

  if (notFound || !site) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 md:px-6 py-16 text-center">
        <h1 className="text-lg font-semibold">Site not found</h1>
        <Link to="/sites" className="mt-3 inline-block text-sm text-primary hover:underline">
          Back to sites
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1280px] px-4 md:px-6 py-6">
      <Link
        to={`/sites/${site.domain}`}
        className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-primary"
      >
        <ArrowLeft size={13} />
        Back to stats
      </Link>
      <h1 className="mt-1 border-b border-border pb-4 text-xl font-semibold">
        Settings for {site.domain}
      </h1>

      <div className="mt-6 flex flex-col gap-6 md:flex-row">
        {/* Sidebar: vertical on desktop, scrollable row on small screens. */}
        <nav
          aria-label="Settings sections"
          className="flex shrink-0 gap-1 overflow-x-auto md:w-52 md:flex-col md:overflow-visible"
        >
          {visibleSections.map((item) => {
            const Icon = item.icon;
            const active = section === item.key;
            const danger = item.key === "danger";
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => selectSection(item.key)}
                aria-current={active ? "page" : undefined}
                className={
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm " +
                  (active
                    ? "bg-black/[0.05] dark:bg-white/[0.07] font-medium text-text-primary"
                    : "text-text-secondary hover:bg-black/[0.03] dark:hover:bg-white/[0.05] hover:text-text-primary") +
                  (danger && !active ? " text-danger/80 hover:text-danger" : "")
                }
              >
                <Icon size={16} className={danger ? "text-danger" : ""} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">
          {section === "general" && <GeneralSettings site={site} />}
          {section === "goals" && (
            <GoalSettings siteId={site.id} domain={site.domain} />
          )}
          {section === "funnels" && (
            <FeatureGate
              feature="funnels"
              title="Funnels"
              description="Define ordered sequences of pages and events and measure where visitors drop off."
            >
              <FunnelSettings siteId={site.id} domain={site.domain} />
            </FeatureGate>
          )}
          {section === "integrations" && (
            <FeatureGate
              feature="search_console"
              title="Google Search Console"
              description="Connect a Search Console property to see Google search performance next to your analytics."
            >
              <SearchConsoleSettings siteId={site.id} domain={site.domain} />
            </FeatureGate>
          )}
          {section === "notifications" && <NotificationSettings site={site} />}
          {section === "visibility" && <VisibilitySettings site={site} />}
          {section === "people" && <TeamSettings site={site} currentUserId={user?.id} />}
          {section === "danger" && <DangerZoneSettings site={site} />}
        </div>
      </div>

      <div className="h-10" />
    </div>
  );
}
