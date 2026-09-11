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

/** The install snippet with copy actions, shared by setup and settings. */
export default function TrackingSnippet({ siteId }: { siteId: string }) {
  const snippet = `<script
  src="${TRACKER_SCRIPT_URL}"
  data-site-id="${siteId}"
  data-endpoint="${TRACKER_ENDPOINT}"
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

      <p className="text-xs text-text-muted">
        Custom events: <code>webyz.event("Signup")</code>, or add{" "}
        <code>data-analytics-event="Signup"</code> to any element.
      </p>
    </div>
  );
}
