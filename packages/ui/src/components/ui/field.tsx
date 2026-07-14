import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

import { fieldInputClass } from "../../forms/field-shell";

/**
 * Field (ADR 0111) — the compound successor to the render-prop `<FieldShell>`.
 * A context provider mints the control id + described-by + invalid state once,
 * and the parts (Label / Description / Control / Error / Warn) wire themselves to
 * it, so a control is accessible by construction: `<Field.Control>` clones its
 * single child and injects `id` / `aria-describedby` / `aria-invalid` /
 * `aria-required`. Also exports the brand form controls `Input` / `Textarea`
 * (the recessed-chrome grammar shared with `fieldInputClass`).
 *
 * A field shows at most one message slot at a time (Error OR Warn) — the same
 * `error ?? warn` convention the shell carried.
 */

interface FieldContextValue {
  /** id for the wrapped control — the Label's `htmlFor` target. */
  fieldId: string;
  descriptionId: string;
  messageId: string;
  /** Space-joined ids of the live describers, or undefined when there are none. */
  describedById: string | undefined;
  invalid: boolean;
  required: boolean;
  setInvalid: (invalid: boolean) => void;
  setWarned: (warned: boolean) => void;
  setHasDescription: (present: boolean) => void;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

function useFieldContext(part: string): FieldContextValue {
  const ctx = React.use(FieldContext);
  if (!ctx) throw new Error(`${part} must be used within <Field>`);
  return ctx;
}

function Field({
  required = false,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { required?: boolean }) {
  const base = React.useId();
  const fieldId = `${base}control`;
  const descriptionId = `${base}description`;
  const messageId = `${base}message`;

  const [invalid, setInvalid] = React.useState(false);
  const [warned, setWarned] = React.useState(false);
  const [hasDescription, setHasDescription] = React.useState(false);

  const describers: string[] = [];
  if (hasDescription) describers.push(descriptionId);
  if (invalid || warned) describers.push(messageId);
  const describedById = describers.length > 0 ? describers.join(" ") : undefined;

  const value = React.useMemo<FieldContextValue>(
    () => ({
      fieldId,
      descriptionId,
      messageId,
      describedById,
      invalid,
      required,
      setInvalid,
      setWarned,
      setHasDescription,
    }),
    [fieldId, descriptionId, messageId, describedById, invalid, required],
  );

  return (
    <FieldContext value={value}>
      <div data-slot="field" className={cn("flex flex-col gap-1.5", className)} {...props}>
        {children}
      </div>
    </FieldContext>
  );
}

function FieldLabel({ className, children, ...props }: React.ComponentProps<"label">) {
  const { fieldId, required } = useFieldContext("Field.Label");
  return (
    <label
      data-slot="field-label"
      htmlFor={fieldId}
      className={cn("text-foreground text-sm font-medium", className)}
      {...props}
    >
      {children}
      {required ? (
        <span className="text-destructive ml-0.5" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { descriptionId, setHasDescription } = useFieldContext("Field.Description");
  React.useEffect(() => {
    setHasDescription(true);
    return () => setHasDescription(false);
  }, [setHasDescription]);
  return (
    <p
      data-slot="field-description"
      id={descriptionId}
      className={cn("text-muted-foreground text-xs", className)}
      {...props}
    />
  );
}

/**
 * Renders its single child control, injecting the context-supplied wiring
 * (`id` / `aria-describedby` / `aria-invalid` / `aria-required`) so the control
 * stays linked to the Label and messages without the call site repeating it.
 */
function FieldControl({ children }: { children: React.ReactElement }) {
  const { fieldId, describedById, invalid, required } = useFieldContext("Field.Control");
  const child = React.Children.only(children) as React.ReactElement<Record<string, unknown>>;
  return React.cloneElement(child, {
    id: fieldId,
    "aria-describedby": describedById,
    "aria-invalid": invalid,
    "aria-required": required || undefined,
  });
}

function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  const { messageId, setInvalid } = useFieldContext("Field.Error");
  React.useEffect(() => {
    setInvalid(true);
    return () => setInvalid(false);
  }, [setInvalid]);
  return (
    <p
      data-slot="field-error"
      id={messageId}
      role="alert"
      className={cn("text-destructive text-xs", className)}
      {...props}
    />
  );
}

function FieldWarn({ className, ...props }: React.ComponentProps<"p">) {
  const { messageId, setWarned } = useFieldContext("Field.Warn");
  React.useEffect(() => {
    setWarned(true);
    return () => setWarned(false);
  }, [setWarned]);
  return (
    <p
      data-slot="field-warn"
      id={messageId}
      role="status"
      className={cn("text-warning text-xs", className)}
      {...props}
    />
  );
}

const FieldCompound = Object.assign(Field, {
  Label: FieldLabel,
  Description: FieldDescription,
  Control: FieldControl,
  Error: FieldError,
  Warn: FieldWarn,
});

/** Brand text input — the recessed-chrome grammar (ADR 0111); React 19 ref-as-prop. */
function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" className={cn(fieldInputClass, className)} {...props} />;
}

/** Brand multiline input — the input grammar plus a vertical resize handle. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldInputClass, "resize-y", className)}
      {...props}
    />
  );
}

export { FieldCompound as Field, Input, Textarea };
