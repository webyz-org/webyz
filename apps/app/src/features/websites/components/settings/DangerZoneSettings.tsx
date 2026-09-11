import { useState } from "react";
import { useNavigate } from "react-router";
import { TriangleAlert } from "lucide-react";

import { Button } from "../../../../shared/components/ui/button";
import { Card, CardContent } from "../../../../shared/components/ui/card";
import { Field } from "../../../../shared/components/Field";
import { useDeleteWebsite } from "../../hooks/useWebsite";
import type { Website } from "../../types";

/** Irreversible actions, behind a type-to-confirm gate. */
export default function DangerZoneSettings({ site }: { site: Website }) {
  const navigate = useNavigate();
  const remove = useDeleteWebsite();
  const [confirmDelete, setConfirmDelete] = useState("");

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/5 p-4">
        <TriangleAlert size={18} className="mt-0.5 shrink-0 text-danger" />
        <div>
          <h2 className="text-sm font-semibold text-danger">Danger zone</h2>
          <p className="text-sm text-text-secondary">
            Destructive actions below can result in irrecoverable data loss.
            Be careful.
          </p>
        </div>
      </div>

      <Card className="border-danger/40">
        <CardContent className="space-y-3">
          <div>
            <h2 className="font-medium text-danger">Delete this site</h2>
            <p className="text-sm text-text-muted">
              Removes the site and all of its analytics data. This cannot be
              undone. Type <strong>{site.domain}</strong> to confirm.
            </p>
          </div>

          <Field
            placeholder={site.domain}
            value={confirmDelete}
            onChange={(e) => setConfirmDelete(e.target.value)}
          />

          <Button
            variant="destructive"
            disabled={confirmDelete !== site.domain || remove.isPending}
            onClick={() =>
              remove.mutate(site.id, { onSuccess: () => navigate("/sites") })
            }
          >
            {remove.isPending ? "Deleting..." : "Delete site"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
