import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";

import OverviewSurface from "../features/dashboard/components/OverviewSurface";
import ContentsCard from "../features/dashboard/components/ContentsCard";
import TechnologyCard from "../features/dashboard/components/TechnologyCard";
import AcquisitionCard from "../features/dashboard/components/AcquisitionCard";
import GeographyCard from "../features/dashboard/components/GeographyCard";
import PeriodPicker from "../features/dashboard/components/PeriodPicker";
import RealtimeBadge from "../features/dashboard/components/RealtimeBadge";
import FilterBar from "../features/dashboard/components/FilterBar";
import FilterButton from "../features/dashboard/components/FilterButton";
import SegmentsMenu from "../features/segments/components/SegmentsMenu";
import ThemeToggle from "../shared/components/ThemeToggle";
import { Field } from "../shared/components/Field";
import { Button } from "../shared/components/ui/button";
import { applyThemeForView } from "../shared/lib/theme";
import { useFilters } from "../features/dashboard/filters";
import {
  useSharedWebsite,
  useUnlockSharedWebsite,
} from "../features/websites/hooks/useWebsite";
import {
  SHARE_LOCKED_EVENT,
  forgetShareToken,
  readShareToken,
  setCurrentShareToken,
  storeShareToken,
} from "../features/websites/shareToken";
import { usePeriod } from "../shared/hooks/usePeriod";

const CONTAINER = "mx-auto max-w-[1280px] px-4 md:px-6";

/**
 * Query parameters an embedding page may put on the share URL.
 *
 *   embed=true            no header, no footer, made to sit inside an iframe
 *   theme=light|dark|system   applied for this view only, never persisted
 *   background=transparent|<hex>   page background; hex with or without '#'
 */
type EmbedOptions = {
  embed: boolean;
  theme: "light" | "dark" | "system" | null;
  background: string | null;
};

const HEX_COLOUR = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const readEmbedOptions = (params: URLSearchParams): EmbedOptions => {
  const embed = params.get("embed") === "true";
  const themeParam = params.get("theme");
  const theme =
    themeParam === "light" || themeParam === "dark" || themeParam === "system"
      ? themeParam
      : null;

  const bgParam = params.get("background");
  let background: string | null = null;
  if (bgParam === "transparent") background = "transparent";
  else if (bgParam && HEX_COLOUR.test(bgParam)) {
    background = bgParam.startsWith("#") ? bgParam : `#${bgParam}`;
  }

  return { embed, theme, background };
};

/**
 * Read-only dashboard behind a share link. No auth: the API allows analytics
 * reads for a site whose dashboard is public, and this page never renders
 * owner-only controls such as settings or the tracking snippet.
 *
 * A share can carry a password. Then every analytics read must send the
 * token `POST /shared/:slug/unlock` hands out, and this page holds that token
 * (shareToken.ts) for as long as it is mounted. The API answering
 * SHARE_PASSWORD_REQUIRED (token expired, password changed) brings the
 * prompt back.
 */
export default function SharedDashboardPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const options = readEmbedOptions(searchParams);
  const { data: site, isLoading, isError } = useSharedWebsite(slug);

  const { period, from, to, setPeriod } = usePeriod();
  const { wire: filters } = useFilters();

  // The analytics queries below start in their own effects, which run before
  // this component's effects, so the interceptor's token is set here, in the
  // same step as the state, never one render late.
  const [token, setToken] = useState<string | null>(() => {
    const stored = slug ? readShareToken(slug) : null;
    setCurrentShareToken(stored);
    return stored;
  });

  const adoptToken = (next: string | null) => {
    setCurrentShareToken(next);
    setToken(next);
  };

  // Leaving the page must not leave a share header on the owner's own calls.
  useEffect(() => () => setCurrentShareToken(null), []);

  // The API said the token is missing or no longer verifies: ask again.
  useEffect(() => {
    if (!slug) return;
    const onLocked = () => {
      forgetShareToken(slug);
      adoptToken(null);
    };
    window.addEventListener(SHARE_LOCKED_EVENT, onLocked);
    return () => window.removeEventListener(SHARE_LOCKED_EVENT, onLocked);
  }, [slug]);

  // Embed appearance: the host page picks the theme and background. Neither
  // is persisted, so a viewer's own preference for the app is untouched.
  useEffect(() => {
    if (!options.embed) return;
    if (options.theme) applyThemeForView(options.theme);
    if (options.background) {
      const html = document.documentElement.style;
      const body = document.body.style;
      const previous = { html: html.background, body: body.background };
      html.background = options.background;
      body.background = options.background;
      return () => {
        html.background = previous.html;
        body.background = previous.body;
      };
    }
  }, [options.embed, options.theme, options.background]);

  if (isLoading) {
    return (
      <div className={CONTAINER + " py-10"}>
        <div className="h-24 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />
      </div>
    );
  }

  if (isError || !site || !slug) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-lg font-semibold">Dashboard unavailable</h1>
        <p className="mt-1 text-[13px] text-text-muted">
          This link is no longer shared, or it never existed.
        </p>
      </div>
    );
  }

  const rootStyle: CSSProperties | undefined = options.background
    ? { background: options.background }
    : undefined;

  if (site.hasPassword && !token) {
    return (
      <div className="min-h-screen bg-bg" style={rootStyle}>
        <SharePasswordGate
          slug={slug}
          siteName={site.name}
          domain={site.domain}
          embed={options.embed}
          onUnlocked={(next) => {
            storeShareToken(slug, next);
            adoptToken(next);
          }}
        />
      </div>
    );
  }

  const scope = { siteId: site.id, period, from, to, filters };

  const controls = (
    <>
      <span className="hidden text-[13px] sm:block">
        <RealtimeBadge siteId={site.id} />
      </span>
      <FilterButton />
      <SegmentsMenu mode="shared" slug={slug} />
      <PeriodPicker value={period} from={from} to={to} onChange={setPeriod} />
    </>
  );

  return (
    <div className="min-h-screen bg-bg" style={rootStyle}>
      {options.embed ? (
        <div className={CONTAINER + " flex flex-wrap items-center justify-end gap-2 pt-4"}>
          {controls}
        </div>
      ) : (
        <header className="sticky top-0 z-40 border-b border-border bg-surface">
          <div className={CONTAINER + " flex h-16 items-center justify-between gap-3"}>
            <div className="flex min-w-0 items-center gap-3">
              <img src="/logo.png" className="h-6 w-auto" alt="" />
              <div className="min-w-0 leading-tight">
                <p className="truncate text-[13.5px] font-semibold text-text-primary">
                  {site.name}
                </p>
                <p className="truncate text-xs text-text-muted">{site.domain}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {controls}
              <ThemeToggle />
            </div>
          </div>
        </header>
      )}

      <div className={CONTAINER + (options.embed ? " pb-6 pt-4" : " pb-12 pt-6")}>
        <FilterBar />

        <OverviewSurface scope={scope} />

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <ContentsCard scope={scope} />
          <AcquisitionCard scope={scope} />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <TechnologyCard scope={scope} />
          <GeographyCard scope={scope} />
        </div>

        {!options.embed && (
          <p className="pt-8 text-center text-xs text-text-muted">
            Public dashboard powered by Webyz
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The password prompt. Same frame as the auth screens: plain ground, one
 * heading scale, one blue button. Inside an iframe the wordmark is dropped
 * so the host page's own chrome is not doubled.
 */
function SharePasswordGate({
  slug,
  siteName,
  domain,
  embed,
  onUnlocked,
}: {
  slug: string;
  siteName: string;
  domain: string;
  embed: boolean;
  onUnlocked: (token: string) => void;
}) {
  const qc = useQueryClient();
  const unlock = useUnlockSharedWebsite(slug);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!password) return;
    setError(null);
    unlock.mutate(password, {
      onSuccess: ({ token }) => {
        // Cards that failed while locked would otherwise show their error
        // until their next natural refetch.
        qc.invalidateQueries({ predicate: (q) => q.state.status === "error" });
        onUnlocked(token);
      },
      onError: (err) => {
        const { code, message } = err as { code?: string; message?: string };
        setError(code === "SHARE_PASSWORD_INVALID" ? "Wrong password. Try again." : message ?? "Something went wrong");
      },
    });
  };

  return (
    <main className={"flex items-center justify-center px-4 " + (embed ? "py-10" : "min-h-screen pb-16")}>
      <div className="w-full max-w-[25rem]">
        {!embed && (
          <div className="mb-6 flex items-center gap-2">
            <img src="/logo.png" alt="" className="h-7 w-auto" />
            <span className="text-[17px] font-bold tracking-tight text-text-primary">webyz</span>
          </div>
        )}

        <div className="flex items-center gap-2 text-text-muted">
          <Lock size={16} />
          <span className="text-[12px] font-medium uppercase tracking-wide">Protected dashboard</span>
        </div>
        <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-text-primary">{siteName}</h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-text-secondary">
          {domain} is shared with a password. Enter it to view the stats.
        </p>

        <form onSubmit={submit} className="mt-7" autoComplete="off">
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter the dashboard password"
            autoComplete="off"
            autoFocus
            error={Boolean(error)}
            helperText={error ?? undefined}
          />
          <Button type="submit" size="lg" className="mt-5 w-full" disabled={unlock.isPending || !password}>
            {unlock.isPending ? "Checking…" : "View dashboard"}
          </Button>
        </form>
      </div>
    </main>
  );
}
