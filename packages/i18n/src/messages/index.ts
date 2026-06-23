import { DEFAULT_LOCALE, type Locale } from "../config";
import type { Messages } from "../messages.types";
import cs from "./cs";
import enInput from "./en";

/**
 * Catalog registry, keyed by `Locale`. Typed as `Messages` (the `cs` literal
 * shape) so the runtime API the providers consume keeps the precise type that
 * drives next-intl/use-intl ICU inference. `cs` IS that type; `en` is authored
 * against the key-parity-equivalent `MessagesInput` (widened leaves) and is a
 * structurally-valid `Messages`, so it is asserted in here at this single seam.
 * The `getMessages` seam means a later move to JSON + a TMS (Crowdin/Phrase) or
 * Lingui extraction happens behind this surface without touching call sites —
 * parallel to ADR 0019's codegen seam.
 */
// `en` is authored as `MessagesInput` (widened leaves, key-parity-checked vs
// `cs`) but is a structurally-valid `Messages`. Assert it ONCE here so the
// registry AND the public `en` re-export both carry the canonical `Messages`,
// never the widened authoring type (consumers like `<I18nProvider messages>`).
const en: Messages = enInput as Messages;
const catalogs: Record<Locale, Messages> = { cs, en };

/**
 * Resolve a locale to its catalog, falling back to `DEFAULT_LOCALE` for an
 * unknown value (defensive — callers should narrow with `isLocale` first).
 */
export function getMessages(locale: Locale): Messages {
  return catalogs[locale] ?? catalogs[DEFAULT_LOCALE];
}

export { cs, en };
