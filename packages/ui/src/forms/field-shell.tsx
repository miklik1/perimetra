import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Shared field chrome for the release editor (and any structured form): a label,
 * optional description, the control, and an error/warn slot — with the
 * `aria-invalid`/`aria-describedby` wiring done once so every field is
 * accessible by construction. The repo's first field wrapper.
 *
 * Children is a render prop so the control owns its own element while FieldShell
 * supplies the linked ids and invalid state:
 *
 * ```tsx
 * <FieldShell label="Width" error={defect?.message}>
 *   {({ fieldId, describedById, invalid }) => (
 *     <input id={fieldId} aria-describedby={describedById} aria-invalid={invalid} {...register("w")} />
 *   )}
 * </FieldShell>
 * ```
 */

/** The canonical control class strings — one source so every field looks alike.
 *  `aria-invalid:border-destructive` drives the red border with no extra class. */
export const fieldInputClass =
  "border-border bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 aria-invalid:border-destructive";
export const fieldTextareaClass = cn(fieldInputClass, "resize-y font-mono");

export interface FieldShellRenderArgs {
  fieldId: string;
  describedById: string | undefined;
  invalid: boolean;
}

export interface FieldShellProps {
  label: React.ReactNode;
  /** Optional helper text under the label (cs). */
  description?: React.ReactNode;
  /** Error-severity message — drives the red border + alert. */
  error?: string;
  /** Warn-severity message — amber, non-blocking. */
  warn?: string;
  /** Marks the label with a required affordance. */
  required?: boolean;
  className?: string;
  children: (args: FieldShellRenderArgs) => React.ReactNode;
}

export function FieldShell({
  label,
  description,
  error,
  warn,
  required,
  className,
  children,
}: FieldShellProps) {
  const fieldId = React.useId();
  const messageId = React.useId();
  const message = error ?? warn;
  const describedById = message ? messageId : undefined;

  return (
    <div className={cn("flex flex-col gap-1", className)} data-slot="field">
      <label htmlFor={fieldId} className="text-sm font-medium">
        {label}
        {required ? <span className="text-destructive ml-0.5">*</span> : null}
      </label>
      {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
      {children({ fieldId, describedById, invalid: error !== undefined })}
      {message ? (
        <p
          id={messageId}
          role={error ? "alert" : "status"}
          className={cn(
            "text-xs",
            error ? "text-destructive" : "text-amber-600 dark:text-amber-500",
          )}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
