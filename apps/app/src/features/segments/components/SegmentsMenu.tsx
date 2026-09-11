import { useState } from "react";
import { Bookmark, BookmarkPlus, Check, Trash2 } from "lucide-react";

import {
  FILTER_LABELS,
  parseFilterValue,
  useFilters,
  type FilterKey,
  type Filters,
} from "../../dashboard/filters";
import { useCreateSegment, useDeleteSegment, useSegments, useSharedSegments } from "../hooks/useSegments";
import type { Segment } from "../types";
import type { ApiError } from "../../../lib/axios";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../shared/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/ui/dialog";
import { Button } from "../../../shared/components/ui/button";
import { Field } from "../../../shared/components/Field";

/**
 * Header dropdown of saved segments. On the owner dashboard it also saves the
 * current filters as a new segment and deletes existing ones; on a public
 * share page it is read-only and lists through the slug endpoint, since the
 * viewer has no session.
 */
type Props =
  | {
      mode: "owner";
      siteId: string;
      /** Owners and admins save and delete; viewers only apply. Defaults to true. */
      canManage?: boolean;
    }
  | { mode: "shared"; slug: string };

/** Stored wire form -> dashboard filters; unknown keys are skipped. */
const segmentToFilters = (segment: Segment): Filters => {
  const filters: Filters = {};
  for (const [key, raw] of Object.entries(segment.filters)) {
    if (!(key in FILTER_LABELS)) continue;
    const condition = parseFilterValue(raw);
    if (condition) filters[key as FilterKey] = condition;
  }
  return filters;
};

/** Mutation errors arrive as the flat ApiError that lib/axios rejects with. */
const errorMessage = (err: unknown) =>
  (err as ApiError | null)?.message ?? "Something went wrong";

const sameFilters = (a: Record<string, string>, b: Record<string, string>) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
};

const TRIGGER_CLASS =
  "flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition-colors duration-150 hover:border-border-strong hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export default function SegmentsMenu(props: Props) {
  const isOwner = props.mode === "owner";
  const canManage = isOwner && props.canManage !== false;
  const siteId = isOwner ? props.siteId : undefined;
  const slug = isOwner ? undefined : props.slug;

  const { wire, hasFilters, replaceFilters } = useFilters();

  // Hooks run unconditionally; whichever mode is off gets an undefined key
  // and stays disabled.
  const owned = useSegments(siteId);
  const shared = useSharedSegments(slug);
  const query = isOwner ? owned : shared;
  const segments = query.data ?? [];

  const create = useCreateSegment(siteId ?? "");
  const remove = useDeleteSegment(siteId ?? "");

  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Segment | null>(null);

  const openSave = () => {
    setName("");
    setSaveError(null);
    create.reset();
    setSaving(true);
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, filters: wire },
      {
        onSuccess: () => setSaving(false),
        onError: (err) => setSaveError(errorMessage(err)),
      },
    );
  };

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
  };

  const activeId = segments.find((s) => sameFilters(s.filters, wire))?.id;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={TRIGGER_CLASS} aria-label="Saved segments">
            <Bookmark size={15} className="text-text-muted" />
            <span>Segments</span>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs text-text-muted">Saved segments</DropdownMenuLabel>

          {query.isLoading && (
            <div className="px-2 py-1.5 text-[13px] text-text-muted">Loading...</div>
          )}
          {query.isError && (
            <div className="px-2 py-1.5 text-[13px] text-text-muted">Could not load segments.</div>
          )}
          {!query.isLoading && !query.isError && segments.length === 0 && (
            <div className="px-2 py-1.5 text-[13px] text-text-muted">
              {canManage
                ? hasFilters
                  ? "No saved segments yet."
                  : "Apply filters, then save them here."
                : "No saved segments."}
            </div>
          )}

          {segments.map((segment) => (
            <DropdownMenuItem
              key={segment.id}
              onSelect={() => replaceFilters(segmentToFilters(segment))}
              className="group flex items-center gap-2"
            >
              <span className="w-3.5 shrink-0">
                {segment.id === activeId && <Check size={14} />}
              </span>
              <span className="min-w-0 flex-1 truncate">{segment.name}</span>
              {canManage && (
                <button
                  type="button"
                  aria-label={`Delete segment ${segment.name}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeleting(segment);
                  }}
                  className="shrink-0 rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </DropdownMenuItem>
          ))}

          {canManage && hasFilters && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={openSave}>
                <BookmarkPlus size={14} />
                Save current filters as segment
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {isOwner && (
        <Dialog open={saving} onOpenChange={(o) => !o && setSaving(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Save segment</DialogTitle>
              <DialogDescription>
                Saves the {Object.keys(wire).length} active filter
                {Object.keys(wire).length === 1 ? "" : "s"} under a name anyone with access to this
                site can apply.
              </DialogDescription>
            </DialogHeader>

            <Field
              label="Name"
              autoFocus
              value={name}
              maxLength={80}
              placeholder="Organic mobile visitors"
              onChange={(e) => {
                setName(e.target.value);
                setSaveError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
              error={Boolean(saveError)}
              helperText={saveError ?? undefined}
            />

            <DialogFooter>
              <Button variant="outline" onClick={() => setSaving(false)} disabled={create.isPending}>
                Cancel
              </Button>
              <Button onClick={save} disabled={!name.trim() || create.isPending}>
                {create.isPending ? "Saving..." : "Save segment"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {isOwner && (
        <Dialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete segment "{deleting?.name}"?</DialogTitle>
              <DialogDescription>
                Only the saved filter set goes; no analytics data is affected.
              </DialogDescription>
            </DialogHeader>
            {remove.isError && (
              <p className="text-[13px] text-destructive">{errorMessage(remove.error)}</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)} disabled={remove.isPending}>
                Keep it
              </Button>
              <Button variant="destructive" onClick={confirmDelete} disabled={remove.isPending}>
                {remove.isPending ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
