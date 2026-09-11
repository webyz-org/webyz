import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router";
import {
  Check,
  ChevronDown,
  CreditCard,
  FileText,
  Globe2,
  KeyRound,
  LayoutGrid,
  LogOut,
  Plus,
  Radio,
  Route,
  SearchCheck,
  Settings,
  Target,
  UserRound,
} from "lucide-react";

import { useAuth, useLogout } from "../../features/auth/hooks/useAuth";
import { useEntitlements } from "../../features/billing/hooks/useEntitlements";
import {
  useSiteByDomain,
  useWebsites,
} from "../../features/websites/hooks/useWebsite";
import ThemeToggle from "../components/ThemeToggle";
import ErrorBoundary from "../components/ErrorBoundary";
import SessionWatcher from "../components/SessionWatcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

const initialsOf = (name?: string) =>
  (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

type NavItem = { name: string; to: string; icon: typeof LayoutGrid };

/**
 * App shell: one 64px sticky header. Logo and site switcher on the left, the
 * analytics sections in the middle, theme and account on the right. Settings
 * live in the site switcher and the account menu rather than competing with
 * the analytics tabs. Below lg the section nav drops to a scrollable row.
 */
export default function MainLayout() {
  const { mutate: logout } = useLogout();
  const navigate = useNavigate();
  const location = useLocation();

  const { user } = useAuth();
  const { data: websites } = useWebsites();

  const { domain } = useParams<{ domain: string }>();
  const { site } = useSiteByDomain(domain);

  const handleLogout = () => {
    logout(undefined, {
      onSuccess: () => navigate("/login"),
      // Even if the request fails the cookie may be gone, so leave anyway.
      onError: () => navigate("/login"),
    });
  };

  const inSiteContext = Boolean(domain);
  const siteBase = site ? `/sites/${site.domain}` : undefined;

  // Plan-gated sections stay listed until the plan is known, then drop out if
  // the plan lacks them. The API enforces this; the nav only avoids dead ends.
  const { entitlements } = useEntitlements();
  const included = (feature: "journeys" | "search_console") => !entitlements || entitlements[feature];

  const siteNav: NavItem[] = siteBase
    ? [
        { name: "Overview", to: siteBase, icon: LayoutGrid },
        { name: "Pages", to: `${siteBase}/pages`, icon: FileText },
        ...(included("search_console") ? [{ name: "Search", to: `${siteBase}/search`, icon: SearchCheck }] : []),
        { name: "Realtime", to: `${siteBase}/realtime`, icon: Radio },
        ...(included("journeys") ? [{ name: "Journeys", to: `${siteBase}/journeys`, icon: Route }] : []),
        { name: "Goals", to: `${siteBase}/conversions`, icon: Target },
      ]
    : [];

  const accountNav: NavItem[] = [
    { name: "Websites", to: "/sites", icon: Globe2 },
    { name: "Plan and billing", to: "/settings/billing", icon: CreditCard },
    { name: "API keys", to: "/settings/api-keys", icon: KeyRound },
    { name: "Account", to: "/settings/account", icon: UserRound },
  ];

  const tabs = inSiteContext ? siteNav : accountNav;

  // Overview is the bare site path, so it matches exactly; other tabs stay
  // lit on their sub-routes (e.g. page detail). The websites list owns
  // /sites and /sites/add only.
  const isActive = (item: NavItem) =>
    item.to === "/sites"
      ? !inSiteContext && location.pathname.startsWith("/sites")
      : location.pathname === item.to ||
        (item.name !== "Overview" &&
          location.pathname.startsWith(item.to + "/"));

  const navLink = (item: NavItem, tall: boolean) => {
    const active = isActive(item);
    return (
      <Link
        key={item.name}
        to={item.to}
        aria-current={active ? "page" : undefined}
        className={
          "relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 " +
          (tall ? "h-16" : "h-10") +
          " " +
          (active
            ? "text-text-primary"
            : "text-text-secondary hover:text-text-primary") +
          " after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-t-full after:transition-colors after:duration-150 " +
          (active ? "after:bg-brand" : "after:bg-transparent")
        }
      >
        {item.name}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-3 px-4 md:px-6">
          {/* Left: brand + site switcher */}
          <Link
            to="/sites"
            className="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <img src="/logo.png" className="h-7 w-auto" alt="" />
            <span className="text-[17px] font-bold tracking-tight text-text-primary">
              webyz
            </span>
            <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-ink">
              Beta
            </span>
          </Link>

          <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-8 max-w-64 items-center gap-2 rounded-md px-2 text-[13.5px] transition-colors duration-150 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:hover:bg-white/[0.06]"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary-soft text-[11px] font-semibold uppercase text-brand-ink">
                  {inSiteContext ? (
                    (site?.domain ?? domain ?? "?")[0]
                  ) : (
                    <Globe2 size={12} />
                  )}
                </span>
                <span className="truncate font-medium text-text-primary">
                  {inSiteContext ? (site?.name ?? domain) : "All websites"}
                </span>
                {inSiteContext && site && (
                  <span className="hidden truncate text-text-muted md:inline">
                    {site.domain}
                  </span>
                )}
                <ChevronDown size={14} className="shrink-0 text-text-muted" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-xs font-medium text-text-muted">
                Websites
              </DropdownMenuLabel>
              {websites?.map((w) => (
                <DropdownMenuItem key={w.id} asChild>
                  <Link to={`/sites/${w.domain}`} className="justify-between">
                    <span className="truncate">{w.domain}</span>
                    {w.domain === domain && (
                      <Check size={14} className="shrink-0 text-brand-ink" />
                    )}
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              {siteBase && (
                <DropdownMenuItem asChild>
                  <Link to={`${siteBase}/settings`}>
                    <Settings size={14} />
                    Site settings
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <Link to="/sites">
                  <Globe2 size={14} />
                  All websites
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/sites/add">
                  <Plus size={14} />
                  Add website
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Centre: section nav (wide screens) */}
          <nav
            className="hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex"
            aria-label="Sections"
          >
            {tabs.map((item) => navLink(item, true))}
          </nav>

          {/* Right: theme + account */}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Account menu"
                  title={user?.name}
                  className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-primary-soft dark:text-brand-ink"
                >
                  {initialsOf(user?.name)}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <div className="px-2 py-1.5">
                  <p className="truncate text-[13px] font-medium text-text-primary">
                    {user?.name}
                  </p>
                  {user?.email && (
                    <p className="truncate text-xs text-text-muted">{user.email}</p>
                  )}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/sites">
                    <Globe2 size={14} />
                    Websites
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings/billing">
                    <CreditCard size={14} />
                    Plan and billing
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings/api-keys">
                    <KeyRound size={14} />
                    API keys
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings/account">
                    <UserRound size={14} />
                    Account
                  </Link>
                </DropdownMenuItem>
                {siteBase && (
                  <DropdownMenuItem asChild>
                    <Link to={`${siteBase}/settings`}>
                      <Settings size={14} />
                      Site settings
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={handleLogout}>
                  <LogOut size={14} />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Section nav on narrower screens: its own scrollable row. */}
        <nav
          className="mx-auto flex max-w-[1280px] items-center gap-1 overflow-x-auto px-2 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Sections"
        >
          {tabs.map((item) => navLink(item, false))}
        </nav>
      </header>

      <main>
        <SessionWatcher />
        {/* A page crash keeps the header, so the user can still navigate. */}
        <ErrorBoundary title="This page hit an error">
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
