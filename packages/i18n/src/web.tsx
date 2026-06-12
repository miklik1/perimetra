"use client";

// Web client binding (ADR 0020): the next-intl hooks + provider for "use client"
// leaves. Re-exports the neutral contract so an app pulls identity, catalogs, and
// the client API from the single "@repo/i18n/web" entry — the mirror of
// "@repo/i18n/native". next-intl separates its client and server entry points,
// so this is a sibling of web.server.ts (they can't collapse into one file).
export * from "./index";

export {
  useTranslations,
  useFormatter,
  useLocale,
  useNow,
  useTimeZone,
  // Aliased to the platform-neutral name the apps use; mirrors the use-intl
  // `IntlProvider` re-exported as `I18nProvider` in native.tsx. Rendered in the
  // RSC layout, it inherits locale + messages from the request config.
  NextIntlClientProvider as I18nProvider,
} from "next-intl";

// Typed-messages augmentation for the WEB engine. Lives here (not in the neutral
// messages.types) because only the web app installs next-intl — see the note in
// messages.types.ts. Makes `t("…")` keys + ICU args type-safe across RSC + client.
declare module "next-intl" {
  interface AppConfig {
    Locale: import("./config").Locale;
    Messages: import("./messages.types").Messages;
  }
}
