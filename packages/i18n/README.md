# @repo/i18n

Internationalization: owns locale identity + shared ICU catalogs + a translatable zod error-map + a locale store, with per-platform engine bindings (next-intl on web, use-intl on mobile) over one catalog (ADR 0020).

## Exports

Neutral barrel (`@repo/i18n`) — no React, no engine runtime:

- `LOCALES`, `DEFAULT_LOCALE`, `DEFAULT_CURRENCY`, `DEFAULT_TIME_ZONE`, `LOCALE_COOKIE`, `isLocale`, `Locale` — locale identity (cs-first).
- `getMessages`, `cs`, `en` — catalog access; `Messages` — typed message shape.
- `createZodErrorMap`, `Translator` — translatable validator messages.
- `createLocaleStore`, `LocaleStorage`, `LocaleState` — the locale state store (its own, like `@repo/auth`).

`@repo/i18n/web` (`"use client"`, re-exports the barrel): `useTranslations`, `useFormatter`, `useLocale`, `useNow`, `useTimeZone`, and `NextIntlClientProvider as I18nProvider`. Installs the next-intl typed-`AppConfig` augmentation.

`@repo/i18n/web/server` (RSC, re-exports the barrel): `getLocale`, `getTranslations`, `getFormatter`, `getNow`, `getTimeZone`, and `buildRequestConfig()` (the body of the app's `i18n/request.ts`).

`@repo/i18n/native` (re-exports the barrel): `useTranslations`, `useFormatter`, `useLocale`, `useNow`, `useTimeZone`, and `I18nProvider` (over use-intl's `IntlProvider`).

## Usage

Translate copy in a client leaf (mirrors `apps/web/app/users-list.tsx`):

```tsx
import { useTranslations } from "@repo/i18n/web";

const t = useTranslations("users");
return <h2>{t("infiniteTitle")}</h2>;
```

The RSC request config is one line over `buildRequestConfig()` — see `apps/web/i18n/request.ts`.

## Decisions

- [ADR 0020](../../docs/adr/0020-i18n-next-intl-use-intl.md) — `@repo/i18n`: next-intl (web, cookie/RSC, "without i18n routing") + use-intl (mobile) over shared ICU catalogs; owns locale identity.
- [ADR 0009](../../docs/adr/0009-forms-rhf-zod-no-package.md) — `createZodErrorMap` translates `@repo/validators` messages for RHF forms.
- [ADR 0023](../../docs/adr/0023-datetime-intl-temporal-deferred.md) — Intl-only date/number formatting; a stable `timeZone` keeps server/client formatting deterministic.
