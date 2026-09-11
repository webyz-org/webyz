import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Button } from "../../../shared/components/ui/button";
import { Field, SelectField } from "../../../shared/components/Field";
import type { Funnel, FunnelInput } from "../types";

const MIN_STEPS = 2;
const MAX_STEPS = 8;

type DraftStep = {
  type: "page" | "event";
  value: string;
  label: string;
};

const emptyStep = (): DraftStep => ({ type: "page", value: "", label: "" });

const fromFunnel = (funnel?: Funnel): DraftStep[] =>
  funnel
    ? funnel.steps.map((s) => ({
        type: s.eventName ? "event" : "page",
        value: s.eventName ?? s.pagePath ?? "",
        label: s.label,
      }))
    : [emptyStep(), emptyStep()];

/**
 * Create or edit a funnel: name plus 2-8 ordered steps, each a page path or a
 * custom event. Suggestions come from data the site has actually recorded.
 */
export default function FunnelBuilder({
  funnel,
  pageSuggestions,
  eventSuggestions,
  onSave,
  onCancel,
  saving,
  error,
}: {
  funnel?: Funnel;
  pageSuggestions: string[];
  eventSuggestions: string[];
  onSave: (input: FunnelInput) => void;
  onCancel: () => void;
  saving: boolean;
  error?: string;
}) {
  const [name, setName] = useState(funnel?.name ?? "");
  const [steps, setSteps] = useState<DraftStep[]>(() => fromFunnel(funnel));

  const patchStep = (index: number, patch: Partial<DraftStep>) =>
    setSteps((prev) =>
      prev.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    );

  const move = (index: number, delta: -1 | 1) =>
    setSteps((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const valid =
    name.trim().length > 0 && steps.every((s) => s.value.trim().length > 0);

  const submit = () =>
    onSave({
      name: name.trim(),
      steps: steps.map((s) => ({
        ...(s.label.trim() ? { label: s.label.trim() } : {}),
        ...(s.type === "event"
          ? { eventName: s.value.trim() }
          : { pagePath: s.value.trim() }),
      })),
    });

  return (
    <div className="space-y-4">
      <Field
        label="Funnel name"
        placeholder="Signup funnel"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="space-y-2">
        <span className="text-sm font-medium">Steps, in order</span>

        {steps.map((step, i) => (
          <div
            key={i}
            className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2"
          >
            <span className="pb-2 text-xs tabular-nums text-text-muted">
              {i + 1}.
            </span>

            <div className="w-32">
              <SelectField
                label="Type"
                value={step.type}
                onChange={(e) =>
                  patchStep(i, {
                    type: e.target.value as DraftStep["type"],
                    value: "",
                  })
                }
              >
                <option value="page">Page visit</option>
                <option value="event">Custom event</option>
              </SelectField>
            </div>

            <div className="min-w-40 flex-1">
              <Field
                label={step.type === "page" ? "Page path" : "Event name"}
                placeholder={step.type === "page" ? "/pricing" : "Signup"}
                value={step.value}
                onChange={(e) => patchStep(i, { value: e.target.value })}
                list={step.type === "page" ? "funnel-pages" : "funnel-events"}
              />
            </div>

            <div className="min-w-32 flex-1">
              <Field
                label="Label (optional)"
                placeholder="Viewed pricing"
                value={step.label}
                onChange={(e) => patchStep(i, { label: e.target.value })}
              />
            </div>

            <div className="flex items-center gap-1 pb-1">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="rounded p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30"
                aria-label={`Move step ${i + 1} up`}
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === steps.length - 1}
                className="rounded p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30"
                aria-label={`Move step ${i + 1} down`}
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                onClick={() =>
                  setSteps((prev) => prev.filter((_, j) => j !== i))
                }
                disabled={steps.length <= MIN_STEPS}
                className="rounded p-1.5 text-text-muted hover:text-danger disabled:opacity-30"
                aria-label={`Remove step ${i + 1}`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}

        <datalist id="funnel-pages">
          {pageSuggestions.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <datalist id="funnel-events">
          {eventSuggestions.map((e) => (
            <option key={e} value={e} />
          ))}
        </datalist>

        <button
          type="button"
          onClick={() => setSteps((prev) => [...prev, emptyStep()])}
          disabled={steps.length >= MAX_STEPS}
          className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary disabled:opacity-40"
        >
          <Plus size={14} />
          Add step ({steps.length}/{MAX_STEPS})
        </button>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={!valid || saving}>
          {saving ? "Saving..." : funnel ? "Save funnel" : "Create funnel"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  );
}
