import { ChevronLeft } from "lucide-react";
import { Link } from "react-router";
import type { ReactNode } from "react";

import { Button } from "../../../shared/components/ui/button";
import { GOOGLE_AUTH_URL, MARKETING_URL } from "../../../config/env";
import { useAuthProviders } from "../hooks/useAuth";

/**
 * One frame for every auth screen: login, signup, forgot and reset. They used
 * to each build their own header, wordmark, heading scale and submit button,
 * which is why the three visible screens did not match. Everything shared
 * lives here so they cannot drift again.
 *
 * Plain white ground, no card: the form is the page. What is shared is the
 * wordmark, the heading scale, the spacing and the one blue primary button.
 */
export default function AuthShell({
  title,
  subtitle,
  back,
  children,
  footer,
  legal,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Top-left escape hatch. Defaults to the marketing site. */
  back?: { label: string; to: string; external?: boolean };
  children: ReactNode;
  footer?: ReactNode;
  legal?: ReactNode;
}) {
  // No marketing site (self-hosted): the auth screens are the front door, so
  // there is nowhere to go "back" to and the link is omitted.
  const link = back ?? (MARKETING_URL ? { label: "Home", to: MARKETING_URL, external: true } : null);

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="flex h-16 shrink-0 items-center px-4 md:px-6">
        {link &&
          (link.external ? (
            <a href={link.to} className={backCls}>
              <ChevronLeft size={16} />
              {link.label}
            </a>
          ) : (
            <Link to={link.to} className={backCls}>
              <ChevronLeft size={16} />
              {link.label}
            </Link>
          ))}
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-[25rem]">
          <div className="mb-6 flex items-center gap-2">
            <img src="/logo.png" alt="" className="h-7 w-auto" />
            <span className="text-[17px] font-bold tracking-tight text-text-primary">webyz</span>
            <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-ink">
              Beta
            </span>
          </div>

          <h1 className="text-[22px] font-semibold tracking-tight text-text-primary">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[13.5px] leading-relaxed text-text-secondary">{subtitle}</p>}

          <div className="mt-7">{children}</div>

          {footer && <p className="mt-5 text-center text-[13.5px] text-text-secondary">{footer}</p>}
          {legal && <p className="mt-6 text-center text-[12px] leading-relaxed text-text-muted">{legal}</p>}

          {/* The product's public pages, for anyone who lands here first:
              a customer following a payment link, or a reviewer checking that
              the domain sells what it says. Only with a marketing site to link to. */}
          {MARKETING_URL && (
            <nav aria-label="About Webyz" className="mt-10 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px] text-text-muted">
              {[
                ["About", ""],
                ["Pricing", "/pricing"],
                ["Docs", "/docs"],
                ["Terms", "/terms"],
                ["Privacy", "/privacy"],
                ["Refunds", "/refunds"],
              ].map(([label, path]) => (
                <a key={label} href={`${MARKETING_URL}${path}`} className="hover:text-text-secondary">
                  {label}
                </a>
              ))}
            </nav>
          )}
        </div>
      </main>
    </div>
  );
}

const backCls =
  "flex items-center gap-1.5 rounded-md py-1 pr-2 text-[13.5px] font-medium text-text-secondary transition-colors duration-150 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/** The one submit button every auth screen uses: blue, full width, 40px. */
export function AuthSubmit({
  pending,
  pendingLabel = "Please wait…",
  children,
}: {
  pending?: boolean;
  pendingLabel?: string;
  children: ReactNode;
}) {
  return (
    <Button type="submit" size="lg" className="mt-5 w-full" disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

/** "or" rule between the form and the Google option. */
function AuthDivider() {
  return (
    <div className="flex items-center gap-3 py-5">
      <span className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">or</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Google sign-in with its "or" divider, matching the submit button's height
 * and radius. Renders nothing until the API has said Google login is
 * configured, so an unconfigured server shows a plain email form instead of a
 * button that redirects to Google with an empty client id.
 */
export function GoogleButton({ label = "Continue with Google" }: { label?: string }) {
  const { google } = useAuthProviders();
  if (!google) return null;

  return (
    <>
    <AuthDivider />
    <a
      href={GOOGLE_AUTH_URL}
      className="flex h-10 w-full items-center justify-center gap-2.5 rounded-lg border border-border bg-surface text-sm font-medium text-text-primary transition-colors duration-150 hover:border-border-strong hover:bg-bg/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <img src="/google.svg" alt="" width={18} height={18} />
      {label}
    </a>
    </>
  );
}
