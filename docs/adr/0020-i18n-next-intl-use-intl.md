# ADR 0020 — i18n: `@repo/i18n` with next-intl (web) + use-intl (mobile), shared ICU catalogs

**Status:** Accepted (2026-06-04). Realizes the i18n item deferred in
[ADR 0008](0008-shared-package-boundaries.md) ("new cross-cutting concerns each
get their own package").

## Context

i18n was the last of the three deferred cross-cutting concerns (telemetry, i18n,
feature flags) named in ARCHITECTURE "Not yet decided". Two constraints shaped
the choice:

1. **Web is RSC-first** (server components by default, `"use client"` at
   interactive leaves only — ADR 0006). The locale must take effect on the
   server so RSC renders already-translated HTML — no untranslated first paint.
   The access token already follows this model via a cookie the Next server
   reads (ADR 0017); locale should use the same cookie-based, server-aware seam.
   Locale-prefixed URLs (`/en/…`) and RTL were explicitly **not** required, so
   `@repo/navigation` and Next middleware stay untouched.
2. **Logic, not pixels, is shared** (ADR 0006/0008). i18n must work on both the
   Next web app and the Expo RN app from one catalog and one API, with thin
   per-platform bindings — the established shape of `@repo/navigation`
   (`web.tsx` / `native.tsx`) and `@repo/store`.

Scope required: typed string translation + interpolation, and **ICU
plurals/select**. Date/number/currency formatting already exists in
`@repo/utils` (Intl-based).

An as-is review also surfaced a real DRY smell this decision resolves:
`DEFAULT_LOCALE = "en-US"` is defined twice (`@repo/config/constants.ts` and
`@repo/utils/src/format/locale.ts`), and the config copy — plus
`DEFAULT_CURRENCY` — is dead (consumed by nothing but its own test). The root
cause is that "who owns locale/currency" had no coherent home.

## Decision

**Create `@repo/i18n`**, a dedicated package that owns **locale identity** and
the **translation contract**, with thin per-platform React bindings. It owns its
own locale state (a `createLocaleStore` factory) the way `@repo/auth` owns
`createAuthStore` rather than pushing it into `@repo/store` — per the
store-placement rule codified in
[ADR 0010 (Amendment)](0010-ui-state-zustand-store-package.md): state lives with
its domain; `@repo/store` is for domain-less app-shell UI state.

**Locales: `cs` + `en`, `cs`-first.** `LOCALES = ["cs", "en"]` and
`DEFAULT_LOCALE = "cs"` — the first product on this skeleton is Czech and may not
render `en` at all, so `cs` is the runtime fallback. `en` is nonetheless kept a
complete, first-class locale so the skeleton stays "ready for `en`" (a one-line
default switch for future projects). A **catalog-parity test** fails CI if `en`
and `cs` ever diverge in keys, so the unused locale cannot silently rot. The
`cs` catalog is the type source-of-truth (`Messages = typeof csMessages`) so the
primary-language author is never blocked; parity guards `en` completeness.

**Engine: next-intl on web, use-intl on mobile, over one shared ICU catalog.**
next-intl is built on the framework-agnostic core **use-intl**, which runs in
any React environment including React Native. This gives one ICU message format
and one `useTranslations`/`useFormatter` API across both platforms with two thin
bindings — the same "share the contract, vary the binding" pattern as
`@repo/navigation`.

- **Web** uses next-intl's _"without i18n routing"_ mode: the active locale is
  read from a cookie inside `getRequestConfig` during the RSC render pass — **no
  `[locale]` URL segment, no middleware**. RSC renders translated; client leaves
  use the same hook. A switcher writes the cookie and calls `router.refresh()`;
  the active locale is read back via next-intl's `useLocale()` (server-consistent
  from the cookie), so the web side needs no locale store — the cookie is the
  single source of truth (a cookie-backed store would hydrate-mismatch).
- **Mobile** uses use-intl's `IntlProvider` fed the same catalogs; initial locale
  from `expo-localization`, with a persisted override via a `createLocaleStore`
  AsyncStorage adapter (the in-memory-mirror + write-behind + hydrate pattern of
  the theme store — ADR 0010/0015).

**Locale ownership / DRY fix.** `@repo/i18n` becomes the single authority for
`LOCALES`, `DEFAULT_LOCALE`, `Locale`, `isLocale`, `LOCALE_COOKIE`, and
`DEFAULT_CURRENCY`. `LOCALE_COOKIE` lives here (not in `@repo/config` alongside
`ACCESS_TOKEN_COOKIE`) because it is **single-domain** — only `@repo/i18n` and
the web app touch it. This is consistent with the ADR 0010 identity-constant
rule: the auth cookie/TTL constants stay in `@repo/config` precisely because
`@repo/api-mocks` consumes them and the DAG forbids `api-mocks → auth`, so config
is their only legal common home; locale has no such cross-domain consumer.
Consequently:

- `@repo/config` drops the dead `DEFAULT_LOCALE` + `DEFAULT_CURRENCY`.
- `@repo/utils/format/locale.ts` renames its constant `DEFAULT_LOCALE →
FALLBACK_LOCALE`, documented as a pure-leaf last-resort default; apps thread
  the active locale from `@repo/i18n` into the formatters explicitly. This keeps
  `@repo/utils` a pure leaf (it must not import i18n) while removing the
  duplicated _authority_ — the two constants now mean different things.

**Dependency DAG (ADR 0008/0011).** Add an `i18n` element
(`packages/i18n/**`), a rule `i18n → {i18n, utils, config}` (in practice only
external deps are used), and `i18n` to the app allow-list. `utils` and `store`
remain pure leaves: locale flows as an explicit argument/prop, never an upward
import — the graph stays acyclic.

**Validation bridge.** `@repo/i18n` exports `createZodErrorMap(t)` mapping zod
issue codes to `errors.*` catalog keys; app boot calls
`z.config({ customError })` so `@repo/validators` messages are translatable
without changing the schemas (consistent with ADR 0009). Per-field RHF wiring is
deferred to the validation-polish work this unblocks.

## Alternatives considered

- **Lingui (one engine, both platforms).** Compile-time extraction, type-safe,
  tiny runtime, ICU-native, RSC-capable. Rejected as the default because it adds
  a build-time macro/compiler plugin to **both** pipelines (swc on web, babel on
  mobile) plus an extract/compile CI step — more moving parts in an already
  carefully tuned build. **Kept as the documented fallback** if use-intl on RN
  proves troublesome.
- **i18next + react-i18next + i18next-icu (one engine, both platforms).** De
  facto standard, largest ecosystem. Rejected: heaviest runtime, RSC integration
  is DIY (a per-request server instance keyed by the cookie), and typed keys are
  bolt-on — the least aligned with the lean, single-responsibility package ethos.
- **next-intl owning a `[locale]` route + middleware.** Rejected: locale-prefixed
  URLs were out of scope and would entangle `@repo/navigation` and Next
  middleware for no required benefit.
- **Putting the locale store in `@repo/store`.** Rejected for cohesion: locale
  state belongs with the locale contract (mirrors `@repo/auth` owning its store),
  and it avoids a `store → i18n` edge.

## Consequences

- One catalog + one hook API across web (incl. RSC) and mobile; the locale/
  currency authority is finally single-homed and the dead config constants and
  duplicated `DEFAULT_LOCALE` are resolved.
- A new package to wire (catalog entry, tsconfig, eslint element, knip entry) —
  the bounded per-package cost ADR 0008 already accepts.
- **Risk:** use-intl on React Native has reported rough edges
  ([next-intl#957](https://github.com/amannn/next-intl/issues/957)). Mitigation:
  pin `use-intl` exact and add a mobile smoke-test alongside the NativeWind v5
  device smoke-test; the Jest `IntlProvider` test is the first guard. If it
  bites, switch to the Lingui fallback (one engine, both platforms) behind the
  same `@repo/i18n` surface.
- The `Messages` type + `getMessages` seam keep a future move to JSON catalogs +
  a TMS (Crowdin/Phrase) or Lingui extraction behind a stable surface — parallel
  to the ADR 0019 codegen seam for the data layer.

## Sources

- next-intl — Core library (use-intl is the framework-agnostic core):
  <https://next-intl.dev/docs/environments/core-library> (verified 2026-06-04).
- next-intl — App Router setup without i18n routing (cookie-based locale,
  `getRequestConfig`, no `[locale]` segment, no middleware):
  <https://next-intl.dev/docs/getting-started/app-router/without-i18n-routing>
  (verified 2026-06-04).
- use-intl on React Native — known issues / official RN example:
  <https://github.com/amannn/next-intl/issues/957> (verified 2026-06-04).
- Comparison (next-intl vs i18next vs Lingui, 2026):
  <https://trybuildpilot.com/910-next-intl-vs-i18next-vs-lingui-2026> (verified 2026-06-04).
