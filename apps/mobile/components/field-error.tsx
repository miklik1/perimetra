import type { ReactNode } from "react";

import { Text } from "./ui";

/**
 * The single sanctioned sink for a form field's validation error (the
 * `no-raw-field-error-message` lint rule forbids rendering `errors.x.message`
 * raw) — the React Native mirror of `@repo/ui`'s web `<FieldError>`. Renders
 * nothing when there is no error.
 *
 * Messages arrive already localized: the zod error-map is wired once at app
 * boot (`z.config`, see `ZodI18nBoot`), so a react-hook-form `error.message`
 * for a generic zod code is the translated string by the time it reaches here.
 */
export interface FieldErrorProps {
  /** A react-hook-form `FieldError` (or any `{ message }`); falsy → renders nothing. */
  error?: { message?: string | undefined } | undefined;
  /** Explicit content, overriding `error.message`. */
  children?: ReactNode;
  className?: string;
}

export function FieldError({ error, children, className }: FieldErrorProps) {
  const content = children ?? error?.message;
  if (!content) return null;
  return (
    <Text
      variant="caption"
      className={className ? `text-destructive ${className}` : "text-destructive"}
    >
      {content}
    </Text>
  );
}
