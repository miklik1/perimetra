# ADR 0017 — Auth client hardening: persisted access token, cross-tab refresh lock, server-side gating + RSC prefetch

**Status:** Accepted (2026-06-03). Amends [ADR 0016](0016-auth-jwt-refresh-package.md).

## Context

ADR 0016 shipped the client auth solution but made one stricter choice than its
production reference (`primat-plus`): the access token lived **in memory only**,
never persisted. That choice forced three gaps, all client-side:

1. **Multi-tab refresh race.** Each tab held its own in-memory token and its own
   per-tab single-flight, but the httpOnly refresh cookie is shared browser-wide.
   Two tabs refreshing concurrently both spend the same refresh token before the
   server's rotation lands → token-family **theft detection** invalidates the
   family → every tab is cross-logged-out.
2. **No server-side auth.** The access token wasn't readable by the Next server,
   so route protection was client-only (a "checking session…" flash) and
   `createServerApiClient` ran with `getToken: () => null` — no RSC prefetch of
   authed routes.
3. **Reload round-trip.** Every reload re-minted the token via `/auth/refresh`
   during validation before the guard resolved.

The skeleton will back the **primat** app and must work against its existing
backend **without backend changes** (rotation + theft detection + httpOnly
refresh cookie are production-proven). We confirmed by reading the primat-plus
client that it does **no client-side CSRF** (relies on `credentials:'include'` +
SameSite) — so no CSRF work is needed here either.

## Decision

**Relax "memory-only" to the standard, primat-aligned approach: persist the
short-lived access token in a JS-readable cookie.** The long-lived refresh token
stays httpOnly. This is the accepted tradeoff (the access token has the same XSS
exposure as localStorage; the durable credential stays out of JS reach). A cookie
(not localStorage) is chosen because it is the one store the Next **server** can
also read, which unlocks the server-side work below.

- **Cookie persistence is a web app-level adapter** (`apps/web/lib/auth-token-cookie.ts`
  - `apps/web/app/auth-bridge.tsx`), not in `@repo/auth` — keeping the package
    free of DOM globals, exactly like `webAuthStorage`/`SessionMonitor` (ADR 0010).
    `<AuthBridge>` hydrates the in-memory token from the cookie at boot and mirrors
    every token change to the cookie via the existing `onTokenChange` seam. The
    package core (`token-manager`) is unchanged — in-memory stays the runtime cache.
- **Cross-tab refresh serialization via the Web Locks API** (`refresh.ts`): the
  refresh round-trip runs inside `navigator.locks.request("auth-refresh", …)` so a
  second tab waits until the first tab's `Set-Cookie` rotation has landed and
  refreshes against the already-rotated cookie. Feature-detected — no
  `navigator.locks` (React Native, SSR, older browsers) falls back to the existing
  in-process single-flight, no worse than before. `/me` is **not** serialized
  (idempotent, no rotation).
- **Cross-tab logout** reuses the persisted-user localStorage key: a logout in one
  tab removes it, firing a `storage` event the others react to (local clear +
  redirect), guarded against echo.
- **Server-side gating via a Next `proxy`** (the Next 16 rename of middleware,
  `apps/web/proxy.ts`): protected paths with no refresh cookie redirect to
  `/login` server-side, removing the unauthenticated flash. Presence-only (not
  validity) — `<AuthGuard>` stays the authoritative client check. Disabled under
  the MSW dev mock (the SW-set cookie never reaches the server).
- **RSC authed prefetch**: `createServerApiClient` reads the access-token cookie
  for its bearer; the `/account` RSC prefetches `me()` and hydrates it.
  Best-effort — there is **no** server-side refresh (it would rotate the family
  and race the client), so an expired cookie token just 401s server-side and the
  browser client re-mints + refetches after hydration.
- **Optimistic reload render**: `<AuthGuard>` renders from the persisted user
  immediately and validates `/me` in the background, redirecting only if it fails.

## Consequences

- The cross-logout multi-tab bug is fixed; concurrent tabs collapse to one
  `/auth/refresh`.
- Protected routes gate server-side (real backend) with the client guard as the
  source of truth; authed RSC prefetch is now possible.
- Reads of `cookies()` make the routes that use the server client dynamic — an
  accepted cost of authed prefetch.
- **Mobile remains deferred** (ADR 0016): no `document.cookie` on native — the
  access token + user will use `expo-secure-store` (in-memory mirror) and the
  refresh token moves to a body-based transport behind the `requestRefresh` seam.
  Web Locks / proxy / RSC are web-only and feature-degrade to no-ops on native.
- **CSRF** is intentionally not implemented client-side (matches primat-plus;
  server-side SameSite + httpOnly refresh cookie).

## Sources

- `apps/web/lib/auth-token-cookie.ts`, `apps/web/app/auth-bridge.tsx`,
  `apps/web/proxy.ts`, `apps/web/lib/server-api.ts`, `apps/web/app/account/*`.
- `packages/auth/src/refresh.ts` (Web Lock), `store/auth-store.ts`
  (`sessionValidated` reset), `react/auth-guard.tsx` (optimistic),
  `react/use-auth.tsx` (`syncLogout`).
- [ADR 0016](0016-auth-jwt-refresh-package.md) (the auth solution this amends),
  [ADR 0010](0010-ui-state-zustand-store-package.md) (adapter-in-app),
  [ADR 0012](0012-api-client-factory.md) (getToken/middleware seams).
