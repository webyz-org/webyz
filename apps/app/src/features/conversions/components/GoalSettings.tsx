import { useState } from "react";
import { Link } from "react-router";
import { Trash2 } from "lucide-react";

import { Button } from "../../../shared/components/ui/button";
import { Card, CardContent } from "../../../shared/components/ui/card";
import { Field, SelectField } from "../../../shared/components/Field";
import {
  useCreateGoal,
  useDeleteGoal,
  useGoals,
} from "../../websites/hooks/useWebsite";
import { useCustomEvents } from "../../dashboard/hooks/useDashboard";

/**
 * Goal management: a goal tracks a custom event or an exact page path as a
 * conversion. Reporting lives on the Conversions page; this is the CRUD.
 */
export default function GoalSettings({
  siteId,
  domain,
}: {
  siteId: string;
  domain: string;
}) {
  const goals = useGoals(siteId || undefined);
  const createGoal = useCreateGoal(siteId);
  const deleteGoal = useDeleteGoal(siteId);

  // Suggests goal names from events actually seen in the last month.
  const customEvents = useCustomEvents(
    { siteId, period: "last_28_days" },
    Boolean(siteId),
  );

  const [goalName, setGoalName] = useState("");
  const [goalType, setGoalType] = useState<"event" | "page">("event");
  const [goalTarget, setGoalTarget] = useState("");

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <h2 className="font-medium">Goals</h2>
          <p className="text-sm text-text-muted">
            Track a custom event or a specific page as a conversion. Results
            live on the{" "}
            <Link
              to={`/sites/${domain}/conversions`}
              className="text-primary hover:underline"
            >
              Conversions page
            </Link>
            .
          </p>
        </div>

        {goals.data?.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {goals.data.map((goal) => (
              <li
                key={goal.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{goal.name}</p>
                  <p className="truncate text-xs text-text-muted">
                    {goal.eventName
                      ? `Event: ${goal.eventName}`
                      : `Page: ${goal.pagePath}`}
                  </p>
                </div>
                <button
                  onClick={() => deleteGoal.mutate(goal.id)}
                  className="text-text-muted hover:text-danger"
                  aria-label={`Delete goal ${goal.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">No goals yet.</p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Goal name"
            placeholder="Signup completed"
            value={goalName}
            onChange={(e) => setGoalName(e.target.value)}
          />

          <SelectField
            label="Type"
            value={goalType}
            onChange={(e) => setGoalType(e.target.value as "event" | "page")}
          >
            <option value="event">Custom event</option>
            <option value="page">Page visit</option>
          </SelectField>

          <Field
            label={goalType === "event" ? "Event name" : "Page path"}
            placeholder={goalType === "event" ? "Signup" : "/pricing"}
            value={goalTarget}
            onChange={(e) => setGoalTarget(e.target.value)}
            list={goalType === "event" ? "seen-events" : undefined}
          />

          {goalType === "event" && (
            <datalist id="seen-events">
              {customEvents.data?.map((e) => (
                <option key={e.name} value={e.name} />
              ))}
            </datalist>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => {
              createGoal.mutate(
                {
                  name: goalName,
                  ...(goalType === "event"
                    ? { eventName: goalTarget }
                    : { pagePath: goalTarget }),
                },
                {
                  onSuccess: () => {
                    setGoalName("");
                    setGoalTarget("");
                  },
                },
              );
            }}
            disabled={!goalName || !goalTarget || createGoal.isPending}
          >
            {createGoal.isPending ? "Adding..." : "Add goal"}
          </Button>

          {createGoal.error && (
            <span className="text-sm text-danger">
              {(createGoal.error as { message?: string }).message}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
