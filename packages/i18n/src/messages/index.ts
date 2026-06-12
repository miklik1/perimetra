import { DEFAULT_LOCALE, type Locale } from "../config";
import type { Messages } from "../messages.types";
import cs from "./cs";
import en from "./en";

/**
 * Catalog registry, keyed by `Locale`. The `getMessages` seam means a later move
 * to JSON + a TMS (Crowdin/Phrase) or Lingui extraction happens behind this
 * surface without touching call sites — parallel to ADR 0019's codegen seam.
 */
const catalogs: Record<Locale, Messages> = { cs, en };

/**
 * Resolve a locale to its catalog, falling back to `DEFAULT_LOCALE` for an
 * unknown value (defensive — callers should narrow with `isLocale` first).
 */
export function getMessages(locale: Locale): Messages {
  return catalogs[locale] ?? catalogs[DEFAULT_LOCALE];
}

export { cs, en };
