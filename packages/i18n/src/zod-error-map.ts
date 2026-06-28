import { z, type ZodErrorMap } from "zod";

/**
 * Minimal translator shape — `(key, values?) => string`. Structurally satisfied
 * by next-intl/use-intl's `useTranslations()`/`getTranslations()` result, but
 * typed locally so this module stays in the neutral contract (no i18n-engine
 * import). The keys it is called with live under the `errors.*` catalog group.
 */
export type Translator = (key: string, values?: Record<string, string | number>) => string;

/**
 * Map zod (v4) issue codes to translatable `errors.*` catalog keys (ADR 0020 /
 * ADR 0009). App boot wires this once with `z.config({ customError:
 * createZodErrorMap(t) })`, so every `@repo/validators` schema message becomes
 * translatable without touching the schemas. Returning `undefined` lets zod fall
 * back to its built-in message for codes we don't translate.
 */
export function createZodErrorMap(t: Translator): ZodErrorMap {
  return (issue) => {
    switch (issue.code) {
      case "invalid_type":
        return t("errors.invalidType", { expected: issue.expected });
      case "too_small": {
        const minimum = Number(issue.minimum);
        switch (issue.origin) {
          case "string":
            return t("errors.tooSmall.string", { minimum });
          case "number":
            return t("errors.tooSmall.number", { minimum });
          case "array":
            return t("errors.tooSmall.array", { minimum });
          default:
            return t("errors.tooSmall.other", { minimum });
        }
      }
      case "too_big": {
        const maximum = Number(issue.maximum);
        switch (issue.origin) {
          case "string":
            return t("errors.tooBig.string", { maximum });
          case "number":
            return t("errors.tooBig.number", { maximum });
          case "array":
            return t("errors.tooBig.array", { maximum });
          default:
            return t("errors.tooBig.other", { maximum });
        }
      }
      case "invalid_format": {
        switch (issue.format) {
          case "email":
            return t("errors.invalidEmail");
          case "url":
            return t("errors.invalidUrl");
          case "uuid":
            return t("errors.invalidUuid");
          default:
            return t("errors.invalidFormat", { format: issue.format });
        }
      }
      case "not_multiple_of":
        return t("errors.notMultipleOf", { divisor: Number(issue.divisor) });
      // Codes we don't translate generically — notably `custom` (the code for
      // `.refine`/`.superRefine`/`z.custom`, the main vehicle for per-field
      // messages in @repo/validators), plus unions/keys/elements. Return
      // `undefined` so zod falls back to the schema's own message instead of
      // clobbering it with a generic string. `errors.invalid` stays available
      // for app code that wants an explicit generic fallback.
      default:
        return undefined;
    }
  };
}

/**
 * Install the error-map on the shared zod instance (`z.config`, ADR 0020) so
 * every `@repo/validators` schema renders generic-code messages through `t`.
 * This is the one place that touches zod's global config; the apps' boot
 * components (`ZodI18nBoot`) call this and never import zod themselves — which
 * also keeps the wiring on the SAME zod instance the validators use (one
 * catalog version, deduped). Re-call on locale change to re-wire.
 */
export function installZodErrorMap(t: Translator): void {
  z.config({ customError: createZodErrorMap(t) });
}
