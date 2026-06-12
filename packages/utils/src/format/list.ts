import { FALLBACK_LOCALE } from "./locale";

/**
 * Join items into a locale-aware list via `Intl.ListFormat` ("a, b a c" /
 * "a, b, and c"). Conjunction by default; pass `{ type: "disjunction" }` for
 * "or" lists.
 */
export function formatList(
  items: readonly string[],
  options: Intl.ListFormatOptions = {},
  locale: string = FALLBACK_LOCALE,
): string {
  return new Intl.ListFormat(locale, options).format(items);
}
