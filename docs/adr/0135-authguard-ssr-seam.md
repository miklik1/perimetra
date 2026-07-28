# ADR 0135 — The AuthGuard SSR seam: seed the first paint from cookie presence

**Status:** Accepted (2026-07-28). Builds on [ADR 0026](0026-web-security-headers-csp.md) (the root layout already reads `headers()` for the CSP nonce), [ADR 0028](0028-feature-flags-posthog.md) (the server-evaluated flag bootstrap this mirrors), [ADR 0018](0018-bff-route-handler-and-shared-mocks.md) (the in-process RSC prefetch that this makes visible) and [ADR 0118](0118-authenticated-app-shell.md) (the app shell whose framed/bare flip must stay joint with the guard). Does not supersede anything: `AuthGuard` keeps every responsibility it had.

## Context

`packages/auth/src/react/auth-guard.tsx` is a `"use client"` component that renders its `fallback` until `useAuth().isAuthenticated` is true. Every file under `packages/auth/src/react/` carries `"use client"`, and Better Auth's session store cannot resolve on the server: its React adapter is a `useSyncExternalStore` over a nanostore whose `getServerSnapshot` **is** `getSnapshot`, the store's initial value is `{data: null, isPending: true}`, and the fetch that would populate it is deferred into a `setTimeout` inside `onMount` guarded by `if (isServer()) return`.

The consequence is not subtle and it is not a corner case. **On the server, every one of the 22 `AuthGuard` call sites renders its loading fallback, always.** The authenticated tree has only ever existed as a post-hydration client render. So for a logged-in user on `/quotes`, the server emits a centred "Ověřování relace…" screen, the browser hydrates, Better Auth fetches `/api/auth/get-session`, and only then does the real page appear — with the app shell's rails appearing at the same moment, because `app-shell.tsx` reads the same `isAuthenticated` and renders `{children}` bare until it flips.

What makes this galling is that **the answer was already known before the page rendered.** The request-time proxy gate (`apps/web/proxy.ts`) checks session-cookie PRESENCE via `hasSessionCookie` and 307s cookie-less visitors to `/login` before any RSC runs. A request that reaches a protected page's RSC therefore carries a session cookie by construction — the proxy just decided so — and each of those pages then goes on to build a cookie-forwarding `createServerApiClient()`, prefetch as the user, and dehydrate into a `<HydrationBoundary>`. All of that work buys a warm client cache and **never a first paint**, because the guard above it painted a spinner into the HTML.

Two ADRs already carry this as a known wart. [ADR 0116](0116-configurator-commercial-plumbing-and-surface.md) records a dev hydration warning on `/configurator` and attributes it to this seam ("AuthGuard renders its fallback on the server and the authenticated tree on the client, so the two never match"); [ADR 0122](0122-login-two-factor-legal-profile-reskin.md) calls it "the carried AuthGuard-SSR hydration warning". (For the record: the hydration-_mismatch_ attribution is recorded-but-unverified — the hydration pass reads the same pending snapshot the server did, so the guard alone should not diverge on the first render. The SSR-always-fallback fact, and the visible fallback→children swap that follows it, are verified from the Better Auth source.)

## Decision

**Give the client the answer the server already has, as a render hint, and change nothing about who is allowed to decide.**

### 1. `initiallyAuthenticated` — one boolean, sourced once, server-side

`apps/web/lib/session-hint.ts` exposes `hasSessionCookieHint()`: read the request's `Cookie` header out of `headers()` and hand it to the existing `@repo/auth` `hasSessionCookie()`. The root layout (`apps/web/app/layout.tsx`) — already `async`, already reading `headers()` for the CSP nonce, so no new dynamic-rendering opt-in and no new I/O — calls it once and passes the boolean into `<Providers>`, which passes it to `<AuthProvider initiallyAuthenticated>`.

It is deliberately **not** a `/v1/me` call. The server _could_ validate the session in-process (`createServerApiClient` exists and every protected page already uses it), and it would still be only a hint by the time the browser acts on it — the session can be revoked between the render and the paint either way. What a validating call would add is a round trip on the root layout, i.e. on **every** route including the public ones, in exchange for shortening an already-harmless optimistic window. Presence is precisely the signal the proxy gate already acts on; using the same signal one layer down keeps the two gates coherent.

### 2. The trust model, stated exactly

**Cookie presence is not authentication.** It is a render hint. It says "the request that produced this HTML carried something shaped like a session", which is what the proxy has always trusted and what the proxy's own doc comment warns "must never authorize anything".

Three properties keep it honest:

- **The redirect is unchanged.** `AuthGuard`'s effect still fires only on a CONFIRMED `sessionValidated && !isAuthenticated`. The seed never suppresses a bounce; it only changes what is painted while the real answer is in flight.
- **The seed's authority expires the moment the truth arrives.** The render condition is `isAuthenticated || (!sessionValidated && initiallyAuthenticated)` — the hint is gated behind `!sessionValidated`, so it applies to the in-flight window only. Once the session resolves, whatever it says wins, in both directions.
- **The server sends no authenticated payload on the strength of it.** The seed gates markup, not data. The RSC prefetch on a revoked cookie 401s, and every protected page is written to survive an empty/null bundle (the pattern [ADR 0125](0125-wave-d-dashboard.md) calls the 401-swallow). The API service remains the sole authority; it does not know or care that the browser painted optimistically.

**The one-tick paint.** A user whose cookie exists but no longer validates now sees the page _chrome_ — rails, empty tables, skeletons — for the gap between hydration and the session response, then gets redirected to `/login`. That is a deliberate trade, and it is the thing a reviewer will (correctly) look at hardest. It leaks nothing: there is no user data in that frame to leak, because the data never arrived. It is the same trade the proxy already makes at request time, moved one layer inward, and it is bounded by a single network round trip on a same-origin endpoint.

### 3. Threaded through the context, not through 22 props

The seed rides the existing `AuthContext` (`AuthContextValue` gains `initiallyAuthenticated: boolean`; `AuthProvider` accepts it as an optional prop defaulting to `false`; `useAuth()` returns it in `UseAuthResult`). **The 22 `AuthGuard` call sites get zero edits**, and the default preserves the previous behaviour exactly for any consumer that does not seed — notably `apps/mobile`, where there is no server render and no cookie header to read.

The seed cannot be pushed into Better Auth's own store. Its React adapter shares one getter between `getSnapshot` and `getServerSnapshot`, and its session query no-ops on the server; there is no supported hook to prime it. The seed therefore has to arrive as React data _above_ the auth client — which is what a provider prop is.

### 4. The AppShell flips jointly, or this fix is worse than the bug

`app-shell.tsx` computes `framed` from the same auth signal, and [ADR 0118](0118-authenticated-app-shell.md)'s doc comment says why: "the flip to framed is joint with that AuthGuard … so nothing resizes on auth-resolve". Every AuthGuard fallback in the app carries `min-h-screen` (most of them `bg-field` too) precisely because it renders _outside_ the frame.

Seeding only the guard would therefore have manufactured a brand-new layout shift on all 22 surfaces: server paints an unframed page, client paints a framed one. So `framed` now reads the identical condition — `(isAuthenticated || (!sessionValidated && initiallyAuthenticated)) && !isChromelessRoute(pathname)`.

The condition is **duplicated rather than extracted into a shared helper**, which is worth recording because it looks like an oversight and is not. `apps/web/components/app-shell/app-shell.test.tsx` module-mocks `@repo/auth/react` down to `useAuth` alone (`vi.mock("@repo/auth/react", () => ({ useAuth: useAuthMock }))`); any second symbol imported from that barrel by the shell would be `undefined` under test and crash every shell case. Both sites carry a comment naming the other and stating that they must stay byte-identical. The invariant the pair upholds — `framed ⟹ AuthGuard renders children`, so a fallback is never painted _inside_ the frame — holds by construction, since `framed` is the guard's condition ANDed with a route predicate.

### 5. The fallback audit — nothing to change, verified per surface

All 22 fallbacks were read rather than assumed, because [ADR 0119](0119-orders-surface-reskin.md), [ADR 0120](0120-quotes-surface-reskin.md), [ADR 0122](0122-login-two-factor-legal-profile-reskin.md), [ADR 0124](0124-wave-c-admin-katalog-reskin.md) and [ADR 0125](0125-wave-d-dashboard.md) each record that per-branch `min-h-screen` decision explicitly. Every one is a `min-h-screen` centred `<main>`: 13 carry `bg-field` (the reskinned deal-flow surfaces — dashboard, projects, customers ×2, quotes ×3, orders ×2, invoices ×2, admin, team/legal-profile) and 9 do not (`account`, `account/security`, `site`, `team`, `platform`, `platform/releases/*` ×2 predate the field-background convention; `configurator` wraps its spinner in `<Field>` instead; `accept-invitation` shows a sign-in prompt rather than a session spinner). All of them are correct unchanged: the fallback branch is now reachable only when the guard's condition is false, and the shell computes `framed = false` from that same condition, so the fallback still renders bare and still needs to size itself. No fallback markup was edited.

### 6. What was NOT built: moving the gate into the RSC

The structurally purer fix is to delete the seam instead of papering it. Each protected `page.tsx` already builds a cookie-forwarding `createServerApiClient()`; on a 401 it could `redirect("/login?next=…")` server-side and drop `<AuthGuard>` from that surface entirely. That is a real server-side gate rather than an optimistic hint, it removes the loading branch instead of hiding it, and it lets the shell learn auth from a server prop rather than a hook.

It was not built here because it is a different-sized change: 22 page rewrites; a client `router.push` becomes a server 307 (different history and back-button semantics, and the three e2e specs that assert the unauthenticated bounce would all move); every page pays a session validation on the server even when its data does not need one; and the routes that AuthGuard is the _only_ gate for (`/`, `/platform/*`, `/team/*`, `/accept-invitation/:id` — absent from `PROTECTED_PREFIXES`) each need their own decision. **Booked as the follow-on.** The seed is forward-compatible with it: a surface converted to an RSC gate simply stops mounting `AuthGuard`, and the seed becomes dead weight for that route rather than something to unwind.

## Consequences

- **The server HTML now contains the real page** for a cookie-bearing request — shell, layout, and the dehydrated RSC prefetch that ADR 0018's in-process client has been producing all along. The fallback→children swap on every navigation into a protected surface is gone, and the RSC prefetch finally buys a first paint, not just a cache hit.
- **A revoked cookie paints app chrome for one round trip before bouncing.** Stated above as the deliberate trade; it carries no user data and does not weaken any server-side check.
- **`useAuth()` grew a field that must be read with care.** `initiallyAuthenticated` is meaningful only in the expression `isAuthenticated || (!sessionValidated && initiallyAuthenticated)`. Read alone it is a cookie-presence bit and would be a security bug in any authorization decision; the type's doc comment says so.
- **Two sites now carry the same condition.** Cross-referenced in both comments, pinned by the guard's unit tests and the shell's; the reason it is not a shared helper is §4 above. If the shell's test ever stops module-mocking the auth barrel, extract it.
- **Mobile and any unseeded host are unchanged** — the prop defaults to `false`, which reproduces the previous behaviour byte for byte. No mobile file was touched.
- **The e2e specs that assert the unauthenticated bounce stay green untouched.** `dashboard-smoke.spec.ts` ("anonymous / redirects to the login page") and `security-headers.spec.ts` both exercise a visitor with **no** cookie, so the seed is `false` and their path is unchanged byte for byte. (`projects-smoke.spec.ts` turns out to assert only the _authed_ path — it signs up first — so it is helped, not threatened: `/projects` now paints its heading from the server.)
- **`AuthGuard` keeps every responsibility it had** — the only gate on the routes absent from `PROTECTED_PREFIXES`, the stale/revoked-cookie bounce on the routes that are, and the loading branch. It is still not an authorization boundary; role gating remains `useRole`/`usePlatformAdmin` (fail-closed) over the authoritative server guards.

## Sources

- `packages/auth/src/react/auth-guard.tsx`, `auth-provider.tsx`, `auth-context.ts`, `use-auth.tsx` — the guard, the seed's carrier, and the hook surface.
- `packages/auth/src/react/react.test.tsx` — the two branches that make the seed honest: seeded + session resolves unauthenticated (children paint first, `redirect` is still called, children come back out), and seeded + live session (the fallback is never painted at all).
- `packages/auth/src/index.ts` `hasSessionCookie` — the presence check, shared verbatim with the proxy gate.
- `apps/web/proxy.ts` — the request-time gate whose decision this reuses; its doc comment on presence-never-validates.
- `apps/web/lib/session-hint.ts`, `apps/web/app/layout.tsx`, `apps/web/app/providers.tsx` — where the seed is read and threaded.
- `apps/web/components/app-shell/app-shell.tsx` — the joint flip.
- `better-auth@1.6.16` `dist/client/react/react-store.mjs` and `dist/client/query.mjs` — `getServerSnapshot === getSnapshot`, and `if (isServer()) return` in the session query: why the store cannot be seeded from within.
