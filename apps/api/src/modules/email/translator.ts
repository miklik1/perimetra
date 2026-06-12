/**
 * Server-side translator over the shared ICU catalogs (ADR 0020 neutral
 * entry — no React): emails render in the USER'S locale (spec §7.4), falling
 * back to the default locale for unknown values.
 */
import { createTranslator } from "use-intl/core";

import { DEFAULT_LOCALE, getMessages, isLocale, type Locale } from "@repo/i18n/server";

export function resolveLocale(raw: string | null | undefined): Locale {
  return isLocale(raw ?? "") ? (raw as Locale) : DEFAULT_LOCALE;
}

export function getEmailTranslator(rawLocale: string | null | undefined) {
  const locale = resolveLocale(rawLocale);
  return createTranslator({ locale, messages: getMessages(locale), namespace: "emails" });
}
