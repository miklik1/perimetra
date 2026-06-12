import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";

import { DEFAULT_TIME_ZONE, type Locale } from "./config";
import type { Messages } from "./messages.types";

// Mobile binding (ADR 0020): use-intl — next-intl's framework-agnostic core —
// running in React Native over the SAME shared catalogs. Re-exports the neutral
// contract so an app pulls identity, catalogs, and the hook API from the single
// "@repo/i18n/native" entry, the mirror of "@repo/i18n/web".
//
// RISK: use-intl on RN has reported rough edges (next-intl#957); `use-intl` is
// pinned exact and the Jest IntlProvider smoke test is the first guard.
export * from "./index";

export { useTranslations, useFormatter, useLocale, useNow, useTimeZone } from "use-intl";

// Typed-messages augmentation for the MOBILE engine. Lives here (not in the
// neutral messages.types) because only the mobile app installs use-intl — see the
// note in messages.types.ts. Makes `t("…")` keys + ICU args type-safe on RN.
declare module "use-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}

type I18nProviderProps = {
  locale: Locale;
  messages: Messages;
  /** Defaults to `DEFAULT_TIME_ZONE`; use-intl warns on date formatting without one. */
  timeZone?: string;
  children: ReactNode;
};

/**
 * Thin wrapper over use-intl's `IntlProvider`, named to match the web
 * `I18nProvider` so app layouts read identically across platforms. Unlike web
 * (locale from the request cookie), mobile feeds `locale`/`messages` from the
 * locale store.
 */
export function I18nProvider({
  locale,
  messages,
  timeZone = DEFAULT_TIME_ZONE,
  children,
}: I18nProviderProps) {
  return (
    <IntlProvider locale={locale} messages={messages} timeZone={timeZone}>
      {children}
    </IntlProvider>
  );
}
