/**
 * Neutral contract for `@repo/i18n` — locale identity + the translation
 * contract, with NO React and NO next-intl/use-intl runtime import (ADR 0020).
 * The per-platform bindings (`@repo/i18n/web`, `@repo/i18n/web/server`,
 * `@repo/i18n/native`) layer the engine on top, re-export everything here, and
 * carry the engine-specific `AppConfig` augmentation that types `t("…")` keys.
 */
export {
  LOCALES,
  DEFAULT_LOCALE,
  DEFAULT_CURRENCY,
  DEFAULT_TIME_ZONE,
  LOCALE_COOKIE,
  isLocale,
  type Locale,
} from "./config";

export { getMessages, cs, en } from "./messages";
export type { Messages } from "./messages.types";

export { createZodErrorMap, type Translator } from "./zod-error-map";

export { createLocaleStore, type LocaleStorage, type LocaleState } from "./store";
