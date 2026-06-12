# Design — `@repo/i18n` (internationalization package)

**Date:** 2026-06-04
**Status:** Implemented (engine: Option A) — web fully wired (request config,
RSC `<html lang>`, LocaleSwitcher, cookie store); mobile provider/store/
`hydrateLocale` built, in-app switcher deferred while the app is dormant
**Decision record:** [ADR 0020](../../adr/0020-i18n-next-intl-use-intl.md)

## Goal

Add internationalization to the skeleton as a dedicated `@repo/i18n` package
(ADR 0008 reserves one per cross-cutting concern). It owns **locale identity**
and the **translation contract**, with thin per-platform React bindings —
structurally identical to `@repo/navigation` (`web` / `native`) and owning its
own locale state the way `@repo/auth` owns `createAuthStore`.

Scope confirmed during brainstorming:

- **In:** typed string translation + interpolation; ICU plurals/select; a
  cookie-based, server-aware locale on web (RSC renders already-translated HTML).
- **Out:** locale-prefixed URLs (`/en/…`), RTL. `@repo/navigation` and Next
  middleware are untouched.

## Engine — next-intl (web) + use-intl (mobile), shared catalogs

next-intl is built on a framework-agnostic core, **use-intl**, which works in
any React environment including React Native. We use:

- **Web:** next-intl in its _"without i18n routing"_ mode — locale resolved from
  a cookie inside `getRequestConfig`, **no `[locale]` URL segment, no
  middleware**. RSC renders translated content; client leaves use the same hook.
- **Mobile:** use-intl's `IntlProvider` + hooks, fed the same ICU catalogs.

One ICU message format, one `useTranslations`/`useFormatter` API, two thin
bindings. Rejected alternatives (Lingui, i18next) and the rationale are in
ADR 0020.

**Risk:** use-intl on React Native has reported rough edges
([next-intl#957](https://github.com/amannn/next-intl/issues/957)). Guard: pin
`use-intl` exact and add a mobile smoke-test alongside the NativeWind v5 device
smoke-test. Documented fallback: Lingui (one engine on both platforms).

## Package layout

```
packages/i18n/
  package.json            # exports: ".", "./web", "./web/server", "./native"
  src/
    config.ts             # LOCALES, DEFAULT_LOCALE, Locale, isLocale, LOCALE_COOKIE, DEFAULT_CURRENCY
    messages/
      en.ts               # ICU catalog (source of truth for the Messages type)
      cs.ts               # ICU catalog
      index.ts            # getMessages(locale): Messages
    messages.types.ts     # Messages = typeof enMessages; global augmentation for typed keys
    zod-error-map.ts      # createZodErrorMap(t): maps zod issue codes -> errors.* keys
    store.ts              # createLocaleStore(storage) + LocaleStorage (mirrors createThemeStore)
    index.ts              # neutral barrel (no React, no next-intl/use-intl)
    web.tsx               # client binding: re-export useTranslations/useFormatter + I18nProvider (next-intl)
    web.server.ts         # RSC binding: getLocale/getTranslations + buildRequestConfig() helper
    native.tsx            # mobile binding: IntlProvider wrapper + useTranslations/useFormatter (use-intl)
```

Exports map (explicit subpaths because next-intl separates its client and server
entry points — they cannot collapse into one conditional `.`):

```jsonc
"exports": {
  ".": "./src/index.ts",
  "./web": "./src/web.tsx",
  "./web/server": "./src/web.server.ts",
  "./native": "./src/native.tsx"
}
```

App code reads identically on both platforms:
`import { useTranslations } from "@repo/i18n/web"` ↔ `"@repo/i18n/native"`.

## Public surface

### Neutral contract — `@repo/i18n` (no React)

- `LOCALES` — `readonly ["cs", "en"]`; `Locale = (typeof LOCALES)[number]`.
- `DEFAULT_LOCALE: Locale = "cs"` — the first product is Czech and may never
  render `en`, so `cs` is the runtime fallback. `en` stays a complete locale (a
  one-line default switch for future projects), guarded by the catalog-parity
  test below.
- `isLocale(value: string | null): value is Locale` — narrows untrusted input
  (cookie value, device locale, stored override) before it selects a catalog.
  Same role as `isThemePreference` in `@repo/store`.
- `LOCALE_COOKIE = "locale"` — the cookie name the web server + client + switcher
  all agree on. Owned here (not in `@repo/config`) because it is **single-domain**
  — only `@repo/i18n` and the web app touch it. This follows the ADR 0010
  identity-constant rule: a single-domain constant lives with its domain. By
  contrast `ACCESS_TOKEN_COOKIE` stays in `@repo/config` because `@repo/api-mocks`
  consumes the auth cookie/TTL constants and the DAG forbids `api-mocks → auth`,
  so config is their only legal common home — not a wart.
- `DEFAULT_CURRENCY = "CZK"` — the locale-adjacent default that was dead (and
  `"USD"`) in `@repo/config`, re-homed here, live, and set to match the cs-first
  default. `formatCurrency(v, DEFAULT_CURRENCY, "cs")` → `"1 234,50 Kč"`.
- `getMessages(locale: Locale): Messages` — returns the catalog; falls back to
  `DEFAULT_LOCALE` for an unknown value.
- `Messages` — `typeof csMessages`; `cs` is the type source-of-truth so the
  primary-language author is never blocked. A global augmentation registers it so
  next-intl and use-intl type `t("…")` keys. The catalog-parity test keeps `en`
  in step.
- `createZodErrorMap(t): ZodErrorMap` — see Validation bridge.
- `createLocaleStore(storage: LocaleStorage)` + `LocaleStorage { get, set }` —
  a vanilla zustand factory bound to platform persistence, identical in spirit
  to `createThemeStore`, but living here per the ADR 0010 store-placement rule
  (state lives with its domain; `@repo/store` is for domain-less app-shell state).

### Web bindings

- `@repo/i18n/web` (client): re-exports `useTranslations`, `useFormatter`, and
  `NextIntlClientProvider` (re-aliased `I18nProvider`) from next-intl.
- `@repo/i18n/web/server` (RSC): re-exports `getLocale`, `getTranslations`, and
  exposes `buildRequestConfig()` — the body of the app's `i18n/request.ts`
  (reads `LOCALE_COOKIE`, narrows with `isLocale`, returns `{ locale, messages }`).

### Mobile binding

- `@repo/i18n/native`: an `I18nProvider` thin-wrapping use-intl's `IntlProvider`
  (passing `locale`, `messages`, `timeZone`) + `useTranslations` / `useFormatter`
  re-exported from use-intl.

## Dependency DAG (ADR 0008 / 0011)

Add to `tooling/eslint/base.js`:

- New element: `{ type: "i18n", mode: "full", pattern: "packages/i18n/**" }`.
- New rule: `from i18n → allow [i18n, utils, config]` (in practice only external
  deps — next-intl, use-intl, zod, zustand — are needed; the internal allowance
  is the conservative ceiling).
- Add `i18n` to the existing `from app → allow […]` list.

`utils` and `store` stay **pure leaves**: nothing imports `@repo/i18n` from
them. The active locale flows to formatters as an explicit argument and to
components as a prop/hook value — never as an upward import. This preserves the
acyclic graph and is why the `utils` formatter fallback is kept local (below).

## The DRY fix (the smell found in the as-is review)

Today `DEFAULT_LOCALE = "en-US"` is defined twice — `@repo/config/constants.ts`
and `@repo/utils/src/format/locale.ts` — and the config copy (plus
`DEFAULT_CURRENCY`, `APP_NAME`) is consumed by nothing outside its own test.
Root cause: "who owns locale/currency" had no coherent answer.

Resolution:

1. **`@repo/config`** — delete the dead `DEFAULT_LOCALE` and `DEFAULT_CURRENCY`.
   (`APP_NAME` is out of scope; leave it, or track separately.)
2. **`@repo/i18n`** — becomes the single authority for `DEFAULT_LOCALE`
   (now `"cs"`, a `Locale`) and `DEFAULT_CURRENCY`.
3. **`@repo/utils/format/locale.ts`** — rename `DEFAULT_LOCALE` →
   `FALLBACK_LOCALE`, documented as the _last-resort_ default for a pure leaf
   that cannot import i18n. Apps thread the active locale from
   `@repo/i18n` into the formatters explicitly. Distinct meaning (a defensive
   fallback vs. the configured locale), so it is no longer a duplicated
   authority — and the `utils` leaf rule is preserved.

(Formatter signatures already accept an explicit `locale` arg, so this is a
rename + doc change plus updated call sites, not an API redesign.)

## Data flow — web (cookie + server-aware)

1. **`apps/web/i18n/request.ts`** — `export default getRequestConfig(async () =>
buildRequestConfig())`; `buildRequestConfig` reads `LOCALE_COOKIE` via
   `next/headers` `cookies()`, narrows with `isLocale` (else `DEFAULT_LOCALE`),
   returns `{ locale, messages: getMessages(locale), timeZone }` — a stable
   `timeZone` (`DEFAULT_TIME_ZONE`) keeps date/number formatting deterministic
   across the server/client boundary (next-intl warns otherwise).
2. **`apps/web/next.config.js`** — wrap with `createNextIntlPlugin('./i18n/request.ts')`.
3. **`apps/web/app/layout.tsx`** — `const locale = await getLocale()`; set
   `<html lang={locale}>`; wrap children in `I18nProvider` with `locale` **and**
   `messages` passed **explicitly** (`getMessages(locale)`) — next-intl v4 does
   not reliably infer the client provider's `locale` here, so passing it is
   required (a missing-prop runtime error otherwise). RSC components call
   `getTranslations()`; client leaves call `useTranslations()`. **No no-FOUC
   script** is needed — unlike theme (client only), the server reads the cookie
   and renders the correct locale on the first byte.
4. **Switcher** — `apps/web/lib/locale-cookie.ts` (app adapter mirroring
   `auth-token-cookie.ts`) writes `LOCALE_COOKIE`; `<LocaleSwitcher>` writes the
   cookie, then `router.refresh()` re-renders RSC in the new locale. It reads the
   active locale back via next-intl's `useLocale()` (seeded from the same cookie
   server-side, so SSR and client agree). **No web locale store** — the cookie is
   the single source of truth and `useLocale()` is the reactive handle; a
   cookie-backed store would init differently on server (no cookie) vs client and
   cause a hydration mismatch. `createLocaleStore` is used on mobile, where there
   is no server-rendered locale source.

## Data flow — mobile

1. **`apps/mobile/lib/locale.ts`** — `createLocaleStore` bound to an AsyncStorage
   adapter using the in-memory-mirror + write-behind + `hydrateLocale` pattern
   from `apps/mobile/lib/theme.ts` (synchronous store seam over async storage).
   Initial locale: a persisted override if present, else
   `expo-localization.getLocales()[0].languageTag` narrowed by `isLocale`, else
   `DEFAULT_LOCALE`.
2. **`apps/mobile/app/_layout.tsx`** — wrap the tree in `I18nProvider`
   (`@repo/i18n/native`) with `locale` from the store and `messages =
getMessages(locale)`. A switcher updates the store → re-render.

## Validation bridge (seeds Tier B)

`createZodErrorMap(t)` maps zod issue codes (`too_small`, `invalid_type`,
`invalid_format` + format subtype, …) to `errors.*` catalog keys with ICU
interpolation (`{minimum}`, `{maximum}`, …). App boot calls
`z.config({ customError: createZodErrorMap(t) })` so `@repo/validators` schema
messages are translatable without touching the schemas (ADR 0009 keeps schemas
in `@repo/validators`; this only translates their messages). Per-field
form-error → message wiring stays Tier B.

## Catalogs

`cs` (primary, type source-of-truth) + `en` (kept complete for skeleton
readiness). ICU strings, including an `errors.*` group for the zod map. Inline
TS catalogs to start; the `Messages` type + `getMessages` seam let a later move
to JSON + a TMS (Crowdin/Phrase) or Lingui extraction happen behind the same
surface — parallel to ADR 0019's codegen seam for the data layer.

A **catalog-parity test** asserts `en` and `cs` expose the identical key set
(deep key comparison), so the locale the first project doesn't render cannot
silently drift — this is what keeps the skeleton "ready for `en`".

## Testing (ADR 0005 two-runner split)

- **Package (Vitest):** `isLocale`, `getMessages` (incl. unknown → default),
  `createZodErrorMap` (issue → translated message), `createLocaleStore`
  (mirrors `theme.test.ts`), and the **catalog-parity test** (`en` ≡ `cs` key
  set).
- **Web (Vitest):** RSC render with `LOCALE_COOKIE=cs` resolves and renders the
  Czech catalog; switching the cookie flips the rendered language.
- **Mobile (Jest + RNTL):** `IntlProvider` + `useTranslations` renders `cs` —
  doubling as the use-intl/RN de-risk for [#957](https://github.com/amannn/next-intl/issues/957).

## Out of scope / deferred

- Locale-prefixed URLs and RTL (not selected).
- Per-field RHF form-error mapping and reusable schema primitives — Tier B
  (validation polish), unblocked by `createZodErrorMap`.
- TMS / translation workflow tooling — behind the `getMessages` seam.
- Mobile device smoke-test of use-intl — gated with the NativeWind smoke-test.

## Catalog of files to create / change (for the plan)

**New (`packages/i18n/`):** `package.json`, `tsconfig.json`, `vitest.config.ts`,
`src/{config,index,web,web.server,native,zod-error-map,store,messages.types}.ts(x)`,
`src/messages/{en,cs,index}.ts`, plus tests.

**Changed:**

- `tooling/eslint/base.js` — i18n element + rule + app allowance.
- `packages/config/src/constants.ts` (+ test) — remove dead locale/currency.
- `packages/utils/src/format/locale.ts` (+ callers/tests) — `DEFAULT_LOCALE` →
  `FALLBACK_LOCALE`.
- `pnpm-workspace.yaml` — catalog entries (`next-intl`, `use-intl` exact,
  `expo-localization` in the expo56 set).
- `apps/web/` — `i18n/request.ts`, `next.config.js`, `app/layout.tsx`,
  `app/providers.tsx` (if client provider needed), `lib/locale-cookie.ts`,
  a `LocaleSwitcher` component.
- `apps/mobile/` — `lib/locale.ts`, `app/_layout.tsx`, a switcher.
- `knip.json` — `packages/i18n` workspace entry.
- `docs/adr/0020-*.md`, `docs/adr/0010-*.md` (store-placement rule amendment),
  `docs/adr/README.md`, `ARCHITECTURE.md`.

Explicitly **not** changed: `ACCESS_TOKEN_COOKIE` stays in `@repo/config` (moving
it would break `api-mocks → auth` boundaries — see ADR 0010 Amendment).
