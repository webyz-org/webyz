import { useState } from "react";

import { Button } from "../../../../shared/components/ui/button";
import { Card, CardContent } from "../../../../shared/components/ui/card";
import { Field, SelectField } from "../../../../shared/components/Field";
import TrackingSnippet from "../TrackingSnippet";
import { useUpdateWebsite } from "../../hooks/useWebsite";
import type { Website } from "../../types";
import { timezonesIncluding } from "../../../../shared/lib/timezones";

/** Site details and the tracking snippet. */
export default function GeneralSettings({ site }: { site: Website }) {
  const update = useUpdateWebsite(site.id);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4">
          <h2 className="font-medium">Site details</h2>

          <Field
            label="Display name"
            defaultValue={site.name}
            onChange={(e) => setName(e.target.value)}
          />

          <SelectField
            label="Reporting timezone"
            defaultValue={site.timezone}
            onChange={(e) => setTimezone(e.target.value)}
            helperText="Decides where each reporting day starts and ends."
          >
            {timezonesIncluding(site.timezone).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </SelectField>

          <div className="flex items-center gap-3">
            <Button
              onClick={() =>
                update.mutate({
                  ...(name && name !== site.name ? { name } : {}),
                  ...(timezone && timezone !== site.timezone
                    ? { timezone }
                    : {}),
                })
              }
              disabled={
                update.isPending ||
                ((!name || name === site.name) &&
                  (!timezone || timezone === site.timezone))
              }
            >
              {update.isPending ? "Saving..." : "Save changes"}
            </Button>

            {update.isSuccess && (
              <span className="text-sm text-success">Saved</span>
            )}
            {update.error && (
              <span className="text-sm text-danger">
                {(update.error as { message?: string }).message}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <div>
            <h2 className="font-medium">Install tracking</h2>
            <p className="text-sm text-text-muted">
              Paste this into the &lt;head&gt; of {site.domain}.
            </p>
          </div>

          <TrackingSnippet siteId={site.id} />
        </CardContent>
      </Card>
    </div>
  );
}
