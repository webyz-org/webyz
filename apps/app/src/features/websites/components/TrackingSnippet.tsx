import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "../../../shared/components/ui/button";
import { TRACKER_ENDPOINT, TRACKER_SCRIPT_URL } from "../../../config/env";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Button type="button" variant="outline" onClick={copy}>
      {copied ? <Check size={15} /> : <Copy size={15} />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/**
 * The automatic events the script can send with no code (docs/tracker.md).
 * Each is one attribute; ticking it here writes it into the snippet, so the
 * person never has to remember the attribute name. Outbound links start
 * ticked, as Plausible turns them on by default; the others start off because
 * every click is an event that counts towards the plan's allowance, and the
 * box is right here to untick.
 */
const OPTIONS = [
  { attr: "data-outbound-links", label: "Outbound links", hint: "clicks on links to other sites" },
  { attr: "data-file-downloads", label: "File downloads", hint: "clicks on links to files such as PDFs" },
  { attr: "data-track-404", label: "404 pages", hint: 'pages carrying <meta name="webyz-404">' },
] as const;

type OptionAttr = (typeof OPTIONS)[number]["attr"];

/** The install snippet with copy actions, shared by setup and settings. */
export default function TrackingSnippet({ siteId }: { siteId: string }) {
  const [enabled, setEnabled] = useState<Record<OptionAttr, boolean>>({
    "data-outbound-links": true,
    "data-file-downloads": false,
    "data-track-404": false,
  });

  const extra = OPTIONS.filter((o) => enabled[o.attr])
    .map((o) => `\n  ${o.attr}="true"`)
    .join("");

  const snippet = `<script
  src="${TRACKER_SCRIPT_URL}"
  data-site-id="${siteId}"
  data-endpoint="${TRACKER_ENDPOINT}"${extra}
  defer
></script>`;

  return (
    <div className="space-y-3">
      <pre className="overflow-x-auto rounded-lg bg-black/[0.04] dark:bg-white/[0.06] p-3 text-xs leading-relaxed">
        {snippet}
      </pre>

      <div className="flex flex-wrap gap-2">
        <CopyButton value={snippet} label="Copy snippet" />
        <CopyButton value={siteId} label="Copy site ID" />
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-text-secondary">Add to the snippet</legend>
        <p className="text-xs text-text-muted">
          Each box adds one attribute to the snippet above. Nothing is saved here: copy the snippet
          again after changing them.
        </p>
        {OPTIONS.map((option) => (
          <label key={option.attr} className="flex items-start gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={enabled[option.attr]}
              onChange={(e) => setEnabled((prev) => ({ ...prev, [option.attr]: e.target.checked }))}
              className="mt-0.5 accent-brand"
            />
            <span>
              <span className="text-text-primary">{option.label}</span>: {option.hint}
            </span>
          </label>
        ))}
      </fieldset>

      <p className="text-xs text-text-muted">
        Custom events: <code>webyz.event("Signup")</code>, or add{" "}
        <code>data-analytics-event="Signup"</code> to any element.
      </p>
    </div>
  );
}
