import { useState, type FormEvent } from "react";

import { Button } from "../../../../shared/components/ui/button";
import { Card, CardContent } from "../../../../shared/components/ui/card";
import { Field, SelectField } from "../../../../shared/components/Field";
import { CopyButton } from "../TrackingSnippet";
import { useSharePassword, useSharing } from "../../hooks/useWebsite";
import type { Website } from "../../types";

/** Public dashboard sharing: the link, an optional password, and the embed snippet. */
export default function VisibilitySettings({ site }: { site: Website }) {
  const sharing = useSharing(site.id);

  const shareUrl = site.publicSlug
    ? `${window.location.origin}/share/${site.publicSlug}`
    : null;

  return (
    <Card>
      <CardContent className="space-y-3">
        <div>
          <h2 className="font-medium">Public dashboard</h2>
          <p className="text-sm text-text-muted">
            Anyone with the link can view this site's stats, without signing
            in. Turning sharing off permanently invalidates the old link and
            removes its password.
          </p>
        </div>

        {site.isPublic && shareUrl ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded bg-black/[0.04] dark:bg-white/[0.06] px-3 py-2 text-xs">
                {shareUrl}
              </code>
              <CopyButton value={shareUrl} label="Copy link" />
            </div>

            <Button
              variant="outline"
              onClick={() => sharing.disable.mutate()}
              disabled={sharing.disable.isPending}
            >
              {sharing.disable.isPending ? "Disabling..." : "Stop sharing"}
            </Button>

            <SharePasswordBlock site={site} />
            <EmbedBlock shareUrl={shareUrl} hasPassword={site.hasPassword} />
          </>
        ) : (
          <Button
            onClick={() => sharing.enable.mutate()}
            disabled={sharing.enable.isPending}
          >
            {sharing.enable.isPending ? "Creating link..." : "Create share link"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

/**
 * Set, change or remove the password in front of the link. The password is
 * never shown back: only whether one is set. Changing it signs every current
 * viewer out of the dashboard, because their tokens stop verifying.
 */
function SharePasswordBlock({ site }: { site: Website }) {
  const { set, clear } = useSharePassword(site.id);
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      setError(`Use ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`);
      return;
    }
    setError(null);
    set.mutate(password, {
      onSuccess: () => {
        setPassword("");
        setEditing(false);
      },
      onError: (err) => setError((err as { message?: string }).message ?? "Could not save the password"),
    });
  };

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div>
        <h3 className="text-sm font-medium">Password</h3>
        <p className="text-sm text-text-muted">
          {site.hasPassword
            ? "Viewers must enter a password before the dashboard loads. Changing or removing it signs every current viewer out."
            : "Optional. Ask viewers for a password before the dashboard loads."}
        </p>
      </div>

      {editing ? (
        <form onSubmit={submit} className="space-y-3" autoComplete="off">
          <Field
            label={site.hasPassword ? "New password" : "Password"}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder={`${PASSWORD_MIN} to ${PASSWORD_MAX} characters`}
            error={Boolean(error)}
            helperText={error ?? "Share it with viewers yourself; it is not shown again here."}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={set.isPending}>
              {set.isPending ? "Saving..." : "Save password"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditing(false);
                setPassword("");
                setError(null);
              }}
              disabled={set.isPending}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditing(true)}>
            {site.hasPassword ? "Change password" : "Set a password"}
          </Button>
          {site.hasPassword && (
            <Button
              variant="outline"
              onClick={() => clear.mutate()}
              disabled={clear.isPending}
            >
              {clear.isPending ? "Removing..." : "Remove password"}
            </Button>
          )}
        </div>
      )}
      {clear.isError && (
        <p className="text-xs text-danger">
          {(clear.error as { message?: string }).message ?? "Could not remove the password"}
        </p>
      )}
    </div>
  );
}

type EmbedTheme = "system" | "light" | "dark";

/** The iframe snippet for the embed mode of the shared page. */
function EmbedBlock({ shareUrl, hasPassword }: { shareUrl: string; hasPassword: boolean }) {
  const [theme, setTheme] = useState<EmbedTheme>("system");

  const src = `${shareUrl}?embed=true&theme=${theme}`;
  const snippet = `<iframe src="${src}" loading="lazy" style="width:1px;min-width:100%;height:1600px" frameborder="0"></iframe>`;

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div>
        <h3 className="text-sm font-medium">Embed</h3>
        <p className="text-sm text-text-muted">
          Put the dashboard inside your own page. The embed hides the header
          and footer and follows the theme you pick; add{" "}
          <code className="text-xs">&amp;background=transparent</code> or{" "}
          <code className="text-xs">&amp;background=ffffff</code> to set the
          page background.
          {hasPassword && " The password is asked inside the frame."}
        </p>
      </div>

      <SelectField
        label="Theme"
        value={theme}
        onChange={(e) => setTheme(e.target.value as EmbedTheme)}
        className="max-w-[12rem]"
      >
        <option value="system">Follow the viewer's system</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </SelectField>

      <div className="flex flex-wrap items-start gap-2">
        <code className="flex-1 overflow-x-auto whitespace-pre rounded bg-black/[0.04] dark:bg-white/[0.06] px-3 py-2 text-xs">
          {snippet}
        </code>
        <CopyButton value={snippet} label="Copy snippet" />
      </div>
    </div>
  );
}
