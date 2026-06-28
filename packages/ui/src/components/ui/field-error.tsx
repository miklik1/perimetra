import type { ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * The single sanctioned sink for a form field's validation error (the
 * `no-raw-field-error-message` lint rule forbids rendering `errors.x.message`
 * raw). It renders nothing when there is no error, and an assertive
 * `role="alert"` element otherwise.
 *
 * Messages arrive already localized: the zod error-map is wired once at app
 * boot (`z.config`, see the app's ZodI18nBoot), so a react-hook-form
 * `error.message` for a generic zod code is the translated string by the time
 * it reaches here. This component is the rendering seam, not the translator.
 */
export interface FieldErrorProps {
  /** A react-hook-form `FieldError` (or any `{ message }`); falsy → renders nothing. */
  error?: { message?: string | undefined } | undefined;
  /** Explicit content, overriding `error.message` (e.g. a server-side field error). */
  children?: ReactNode;
  /** Id to wire from the field's `aria-describedby`. */
  id?: string;
  className?: string;
}

export function FieldError({ error, children, id, className }: FieldErrorProps) {
  const content = children ?? error?.message;
  if (!content) return null;
  return (
    <p id={id} role="alert" className={cn("text-destructive text-xs", className)}>
      {content}
    </p>
  );
}
