import * as React from "react";

import { cn } from "../../lib/utils";
import { Input } from "./ui/input";

type FieldProps = React.ComponentProps<"input"> & {
  label?: string;
  error?: boolean;
  helperText?: string;
};

/**
 * Labelled input with inline validation text.
 *
 * The shadcn Input is a bare <input>; pages were passing label/error/helperText
 * straight to it, which does not typecheck and rendered nothing. This wraps it
 * instead of widening the primitive.
 */
export const Field = React.forwardRef<HTMLInputElement, FieldProps>(
  ({ label, error, helperText, className, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium">
            {label}
          </label>
        )}

        <Input
          id={inputId}
          ref={ref}
          aria-invalid={error || undefined}
          className={cn(error && "border-danger", className)}
          {...props}
        />

        {helperText && (
          <p
            className={cn(
              "text-xs",
              error ? "text-danger" : "text-text-muted",
            )}
          >
            {helperText}
          </p>
        )}
      </div>
    );
  },
);

Field.displayName = "Field";

type SelectFieldProps = React.ComponentProps<"select"> & {
  label?: string;
  error?: boolean;
  helperText?: string;
};

export const SelectField = React.forwardRef<
  HTMLSelectElement,
  SelectFieldProps
>(({ label, error, helperText, className, id, children, ...props }, ref) => {
  const generatedId = React.useId();
  const selectId = id ?? generatedId;

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={selectId} className="block text-sm font-medium">
          {label}
        </label>
      )}

      <select
        id={selectId}
        ref={ref}
        className={cn(
          "h-9 w-full rounded-lg border border-input bg-surface px-3 text-sm outline-none",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          error && "border-danger",
          className,
        )}
        {...props}
      >
        {children}
      </select>

      {helperText && (
        <p className={cn("text-xs", error ? "text-danger" : "text-text-muted")}>
          {helperText}
        </p>
      )}
    </div>
  );
});

SelectField.displayName = "SelectField";
