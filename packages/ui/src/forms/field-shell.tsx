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
 *  Recessed-chrome grammar (ADR 0111): a `bg-chrome-subtle` fill with a hairline
 *  inset ring for definition (NOT a hard border, per the no-borders rule), the
 *  copper focus ring, and soft-geometry radius. `aria-invalid` swaps the ring to
 *  destructive with no extra class at the call site. */
export const fieldInputClass =
  "ease-brand w-full rounded-control bg-chrome-subtle px-3 py-2 text-sm text-chrome-foreground outline-none ring-1 ring-inset ring-border/60 transition-[box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-ring aria-invalid:ring-2 aria-invalid:ring-destructive";
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
          className={cn("text-xs", error ? "text-destructive" : "text-warning")}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
