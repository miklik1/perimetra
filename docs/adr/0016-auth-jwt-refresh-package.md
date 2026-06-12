# ADR 0016 — Auth: JWT + refresh-token rotation in a `@repo/auth` package

**Status:** Accepted (2026-06-03).

## Context

The skeleton reserved auth for its own package (ADR 0008; ARCHITECTURE "Not yet
decided") but shipped only a `getToken: () => null` stub in both apps. We needed
a real client-side auth solution, modelled on an existing in-house app
(`primat-plus`): a short-lived access-token JWT (≈15 min) held in memory, a
long-lived refresh token in an httpOnly cookie with server-side rotation +
token-family theft detection, silent `401 → refresh → retry`, proactive session
refresh, and a route guard. That app is web-only, Next.js against a separate PHP
backend; this skeleton is cross-platform (web + Expo) with strict ADR
conventions. So the solution had to be **adapted, not copied**.

Two structural questions had to be answered first:

1. **Where does the refresh logic live without coupling `@repo/api` to auth?**
   `createApiClient` already exposes the seams (ADR 0012): a `getToken` hook and
   a `middleware: ApiMiddleware[]` chain. The risk was a cycle if `@repo/api`
   reached back into auth.
2. **Where does the auth store live, and how does it persist per platform?**
   `@repo/store` owns the factory + injected-storage-adapter convention
   (ADR 0010), but it is scoped to UI state, not a cross-cutting concern.

A separate constraint: the skeleton has no backend (the real API is the imminent
next workstream), so the flow had to be runnable and testable against a mock.

## Decision

**A new `@repo/auth` package owns the auth solution. The data layer stays
auth-agnostic; auth plugs into it via the ADR 0012 seams.**

- **Acyclic dependency: `auth → api`, never the reverse.** The `401 → refresh →
retry` logic is an `ApiMiddleware` value produced by `@repo/auth`
  (`createRefreshMiddleware`) and passed into `createApiClient({ middleware })`
  **by the app**. `@repo/api` never imports `@repo/auth`. The refresh call itself
  uses a **bare `fetch`** (not the wrapped client) so it can't re-enter the 401
  interceptor and loop. ESLint enforces the direction: the `api` boundary rule
  omits `auth`, so adding `@repo/auth` to `packages/api` fails lint (ADR 0011).
- **Zero-dependency token-manager** (`token-manager.ts`) holds the in-memory
  access token + expiry and a subscriber list. It imports nothing, so both the
  middleware and the store depend on it without a cycle. It is a deliberate
  per-runtime singleton — the documented exception to ADR 0012's no-module-global
  rule, because an access token is one ambient credential, not per-client config.
- **Bearer injection via the client's built-in `getToken`** (apps pass
  `getToken: tokenManager.getToken`). A `createBearerMiddleware` exists for parity
  but is not the canonical web path.
- **Auth store lives in `@repo/auth`, not `@repo/store`** (auth is a cross-cutting
  concern, ADR 0008), but follows the same convention: `createAuthStore(storage:
AuthStorage)` on `zustand/vanilla`, mirroring `createThemeStore`. The **package
  holds only the `AuthStorage` interface; the concrete adapters live in the apps**
  (web `localStorage`, mobile deferred secure-store) — exactly as `@repo/store`
  keeps `ThemeStorage` in the package and its adapters in the apps (ADR 0010).
  This also keeps `@repo/auth` free of DOM/native globals so it type-checks under
  both the web and RN libs. Only the user identity is persisted — the access token
  stays in memory, the refresh token in the httpOnly cookie — so a reload re-mints
  an access token via the refresh path during validation.
- **React surface on `@repo/auth/react`** (`"use client"`): `AuthProvider`,
  `useAuth`, `AuthGuard` — DOM-agnostic, so they type-check under both libs; same
  server-safe-barrel + client-subpath split as `@repo/api` (ADR 0006). The guard
  takes a `redirect` callback so it stays router-agnostic. Browser-specific
  effects — the tab-visibility **`SessionMonitor`** (proactive refresh) — live in
  the **app** (like `@repo/store`'s `ThemeEffect`), built on `refreshAccessToken`
  - `getExpiresAt` from the package. The **login form** is per-app (RHF + zod,
    ADR 0009); the `loginSchema` lives in `@repo/validators`.
- **Single-flight refresh** shared by the 401 middleware and `SessionMonitor`, so
  a burst of 401s (or a 401 racing the proactive refresh) collapses to one
  `/auth/refresh`.
- **Mock backend = MSW, web only.** Group-toggleable handlers selected by
  `NEXT_PUBLIC_MSW_MOCKS` (`onUnhandledRequest: "bypass"` in dev → unmocked
  endpoints hit the real API; `"error"` in Vitest). `msw/native` is deliberately
  **not** adopted: it is a maintainer-flagged WIP needing polyfills, and the
  mobile app is dormant. The injectable client seam lets a mobile mock — or the
  real API — drop in later with no change to `@repo/auth`.
- **Mobile is wired but dormant.** `apps/mobile` constructs the same client +
  middleware + `AuthProvider`, proving the core is platform-agnostic, but the
  storage adapter is an in-memory stub and there is no login screen.

## Consequences

- One auth package, one error idiom (ADR 0014): login/`/me` failures surface as
  `ApiError` through TanStack; refresh failures clear the token and bubble the
  original 401.
- `@repo/api` is unchanged structurally — it already accepted middleware; auth is
  additive and the acyclic edge is lint-enforced.
- The reload story works without server-side token plumbing: persisted user +
  refresh-on-401 re-mints the access token transparently.
- **Deferred (own follow-up):** mobile `expo-secure-store` adapter; the mobile
  refresh transport (send the refresh token from secure storage in the body
  instead of a cookie — designed for behind the single `requestRefresh` seam);
  mobile login screen; a mobile mock; RSC server-side prefetch of authed routes
  (the access token isn't available server-side today).

## Sources

- `packages/auth/src/*` — token-manager, `createRefreshMiddleware`,
  `createAuthStore`, `validateSession` / `performFullLogout`, `@repo/auth/react`.
- `packages/api/src/client/create-api-client.ts` — the `getToken` + `middleware`
  seams auth plugs into (no api → auth dependency).
- [ADR 0008](0008-shared-package-boundaries.md) (own package per concern),
  [ADR 0009](0009-forms-rhf-zod-no-package.md) (per-app forms),
  [ADR 0010](0010-ui-state-zustand-store-package.md) (store factory + adapter),
  [ADR 0011](0011-enforce-package-boundaries-with-eslint.md) (boundary enforcement),
  [ADR 0012](0012-api-client-factory.md) (middleware/getToken seams),
  [ADR 0014](0014-error-handling-exceptions-at-the-data-seam.md) (exceptions at the seam).
- MSW React Native integration status (maintainer "potentially incomplete"
  notice) — https://mswjs.io/docs/integrations/react-native/.
