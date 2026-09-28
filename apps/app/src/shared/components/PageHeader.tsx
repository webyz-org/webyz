import type { ReactNode } from "react";

/**
 * The header every site sub-page carries (Pages, Conversions, Journeys,
 * Realtime, Search, Outbound): "<site> · <title>" as a small uppercase
 * eyebrow, one line of description, and the page's controls on the right.
 * The Overview keeps its own larger header on purpose: it is the site's
 * home, the sub-pages hang off it.
 */
export default function PageHeader({
  siteName,
  title,
  description,
  titleAside,
  actions,
}: {
  siteName: string;
  title: string;
  /** One line under the title; plain text or a small status line. */
  description?: ReactNode;
  /** Sits on the title's line, e.g. Realtime's connection indicator. */
  titleAside?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
            {siteName} · {title}
          </h1>
          {titleAside}
        </div>
        {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
      </div>

      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
