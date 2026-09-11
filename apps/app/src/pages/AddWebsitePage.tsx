import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router";

import { Button } from "../shared/components/ui/button";
import { allTimezones, browserTimezone as browserTz } from "../shared/lib/timezones";
import { Field, SelectField } from "../shared/components/Field";
import { useCreateWebsite } from "../features/websites/hooks/useWebsite";
import {
  addWebsiteSchema,
  type AddWebsiteInput,
} from "../features/websites/schema";

// Every zone the browser knows, the browser's own first (shared/lib/timezones).
const browserTimezone = browserTz();
const TIMEZONES = allTimezones();

export default function AddWebsitePage() {
  const navigate = useNavigate();
  const { mutate, isPending, error } = useCreateWebsite();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AddWebsiteInput>({
    resolver: zodResolver(addWebsiteSchema),
    defaultValues: { timezone: browserTimezone || "UTC" },
  });

  const onSubmit = (data: AddWebsiteInput) => {
    mutate(data, {
      // To the setup screen: snippet plus wait-for-first-event verification.
      onSuccess: (site) => navigate(`/sites/${site.domain}/setup`),
    });
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      <h1 className="mb-1 text-xl font-semibold">Add website</h1>
      <p className="mb-6 text-sm text-text-muted">
        You will get a tracking snippet once the site is created.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <Field
          label="Website name"
          placeholder="My SaaS"
          {...register("name")}
          error={Boolean(errors.name)}
          helperText={errors.name?.message}
        />

        <Field
          label="Domain"
          placeholder="example.com"
          {...register("domain")}
          error={Boolean(errors.domain)}
          helperText={
            errors.domain?.message ??
            "Without https:// or www. Subdomains are tracked separately."
          }
        />

        <SelectField
          label="Timezone"
          {...register("timezone")}
          error={Boolean(errors.timezone)}
          helperText={errors.timezone?.message ?? "Used for daily reporting boundaries."}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </SelectField>

        {error && (
          <p className="text-sm text-danger">
            {(error as { message?: string }).message ?? "Could not create site"}
          </p>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating..." : "Add website"}
          </Button>
          <Link to="/sites">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
