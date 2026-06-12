# ADR 0010 — UI state: Zustand in a `@repo/store` package; theme as the first store

**Status:** Accepted (2026-06-01). Amended 2026-06-04 (store-placement rule — see
the Amendment section).

## Context

The skeleton needs a client UI-state pattern distinct from server state (which
is TanStack Query's job, [ADR 0007](0007-rest-data-layer.md)). The first real
UI state is **theme** — a `light | dark | system` preference with a resolved
color scheme — chosen because it also activates web's declared-but-unused
`@custom-variant dark` seam and mirrors mobile's existing `useColorScheme`
wiring ([ADR 0004](0004-theming-token-system.md), [ADR 0001](0001-styling-split-ui-tailwind-v4.md)).

Unlike forms ([ADR 0009](0009-forms-rhf-zod-no-package.md)), this concern has a
**real shared core** that justifies a package under [ADR 0008](0008-shared-package-boundaries.md):

- The theme **state machine** is platform-neutral: hold `theme` (the
  preference) + derive `resolvedScheme`, with `setTheme` / `toggle`. Identical
  logic on both platforms.
- Only the **edges** differ: persistence (web `localStorage`; mobile device
  storage) and the apply-effect (web toggles `.dark` on `documentElement`;
  mobile drives NativeWind's `colorScheme`).
- That is **two real adapters around one core** — a real seam, not a
  hypothetical one. Deleting the package would duplicate the state machine
  across both apps (the deletion test concentrates complexity → it earns its
  keep).

## Decision

- **Create `@repo/store`** — the client UI-state package, built on
  `zustand@^5.0.14` (default pnpm catalog; pure-JS, works on web + RN).
- **Shape it as a factory:** `createThemeStore(storage)` returns a Zustand store
  bound to an injected `ThemeStorage` adapter (`get`/`set`), so the platform-
  neutral state machine lives in the package and each app supplies its own
  storage + apply-effect. The package depends only on `zustand` (a leaf in the
  ADR 0008 DAG; see [ADR 0011](0011-enforce-package-boundaries-with-eslint.md)
  for the boundary update).
- **Server state stays in `@repo/api`** (TanStack Query). `@repo/store` is for
  ephemeral/persisted _client_ UI state only — never a cache of server data.

## Consequences

- Apps consume `@repo/store` for UI state; the theme state machine is written
  and tested once.
- The ADR 0011 boundary matrix gains `app → @repo/store` and
  `@repo/store → (zustand only)`; eslint enforces it.
- Web's dark mode becomes live (the store sets `.dark`), closing the platform
  asymmetry flagged in the architecture review.
- New UI state is placed by the store-placement rule in the Amendment below
  (domain state lives with its domain; `@repo/store` holds domain-less app-shell
  state), or kept app-local when it is not shared — the package is not a dumping
  ground.
- **Mobile persistence (follow-up): resolved 2026-06-01.** The mobile
  `ThemeStorage` is now backed by AsyncStorage
  (`@react-native-async-storage/async-storage`, SDK-pinned via `expo install` and
  guarded by `expo install --check`), reaching parity with web's `localStorage`.
  Since the seam is synchronous and AsyncStorage is not, `apps/mobile/lib/theme.ts`
  bridges them with an in-memory mirror (instant `get`/`set` + write-behind) seeded
  from disk once at boot by `hydrateTheme()` (called from `ThemeEffect`); a
  `settled` guard keeps a late seed from clobbering a same-session choice. The
  native splash is held until `hydrateTheme()` settles so the first frame is in the
  right scheme (no cold-start flash). The storage engine choice (AsyncStorage over
  MMKV, to keep the app Expo Go-compatible) is recorded in
  [ADR 0015](0015-mobile-storage-asyncstorage-over-mmkv.md).

## Amendment (2026-06-04) — store-placement rule

When `@repo/auth` shipped ([ADR 0016](0016-auth-jwt-refresh-package.md)) it put
its session state in `createAuthStore` **inside `@repo/auth`**, not in
`@repo/store`. With `@repo/i18n` ([ADR 0020](0020-i18n-next-intl-use-intl.md))
adding a locale store, the placement needed a stated rule rather than a per-case
call. Two coherent rules were weighed:

- **A — state lives with its domain** (what `auth` already does): a concern that
  owns a package owns its store; `@repo/store` is for domain-less app-shell UI
  state.
- **B — all stores in `@repo/store`**: one state hub importing each domain's
  types.

**Decision: Rule A.** Three reasons, the first decisive:

1. **Rule B creates an import cycle.** `@repo/auth/react`'s provider consumes
   `createAuthStore` (`react/auth-provider.tsx`). Hosting the store in
   `@repo/store` would require `auth → store` (provider needs the store) **and**
   `store → auth` (store needs auth's types) — a cycle
   `eslint-plugin-boundaries` ([ADR 0011](0011-enforce-package-boundaries-with-eslint.md))
   rejects. The same trap applies to i18n. Rule A keeps the graph acyclic and
   `@repo/store` a leaf.
2. **It is ADR 0008's own thesis.** [ADR 0008](0008-shared-package-boundaries.md)
   retired `@repo/shared` because _"'shared' is not a responsibility"_. Grouping
   by mechanism ("things that are Zustand stores") is the same grab-bag shape;
   grouping by domain is the rule every other package follows.
3. **Cohesion / deletability.** Deleting `@repo/i18n` takes its store with it;
   nothing dangles in `@repo/store`.

**The rule:**

- **State / stores** live with their domain package (`@repo/auth` →
  `createAuthStore`; `@repo/i18n` → `createLocaleStore`; future `@repo/flags` →
  its store). `@repo/store` is reserved for **domain-less app-shell UI state**
  (theme today; later e.g. sidebar/layout). Decision test: _does this state
  belong to a named domain package? → it lives there; is it generic app-shell UI
  with no domain? → `@repo/store`._
- **Identity constants** follow the same instinct **with a graph caveat:** a
  constant used by only one domain lives in that domain (e.g. `LOCALE_COOKIE` in
  `@repo/i18n`); a constant shared by two sibling domains that cannot depend on
  each other lives in the shared leaf `@repo/config`. Concretely
  `ACCESS_TOKEN_COOKIE` / `REFRESH_TOKEN_COOKIE` / `ACCESS_TOKEN_TTL_MS` stay in
  `@repo/config` **because `@repo/api-mocks` consumes them and the DAG forbids
  `api-mocks → auth`** — config is their only legal common home, not a wart.

Consequence for the DAG: each new domain store adds no new boundary edge (the
store is internal to its domain package). `@repo/store` stays a pure leaf.

## Sources

- Zustand v5 (https://zustand.docs.pmnd.rs) — store factory + `persist`-free
  injected-storage pattern for cross-platform reuse.
- [ADR 0004](0004-theming-token-system.md) (token/dark-variant system),
  [ADR 0008](0008-shared-package-boundaries.md), [ADR 0011](0011-enforce-package-boundaries-with-eslint.md).
- Amendment cross-refs: [ADR 0016](0016-auth-jwt-refresh-package.md) (auth store
  precedent), [ADR 0020](0020-i18n-next-intl-use-intl.md) (locale store).
