# ADR 0018 — Same-origin BFF route handler + shared framework-agnostic mocks

**Status:** Accepted (2026-06-03). Amends [ADR 0012](0012-api-client-factory.md) (transport base URL) and supersedes the browser-only MSW mock stance of [ADR 0016](0016-auth-jwt-refresh-package.md).

## Context

The data-layer hardening pass surfaced two coupled problems with how the skeleton
talked to its backend and mocked it.

**Mocks were invisible server-side.** Mocking was browser-only MSW (a service
worker) living in `apps/web/mocks/`. RSC fetches, the Next `proxy` middleware, and
the httpOnly refresh cookie all run on the server, where the worker doesn't exist.
The auth pass already paid for this: `proxy.ts` had to **disable its own
protected-route gate** under MSW (the SW-set cookie never reached the server), so
the full protected-route flow could not be exercised against mocks. Handlers were
also colocated in the web app — not reusable by Expo or shared cleanly — and the
fixtures were two static users with no latency simulation.

**Transport hit the backend directly.** Both the browser and RSC pointed at
`NEXT_PUBLIC_API_URL`, exposing the backend origin to the client and giving RSC
and the browser two separate paths with no single seam for credential/header
handling.

The two production references diverge here by their nature: `primat-plus` is a
client SPA (direct + browser MSW is fine); `commerce-storefront` is server-rendered
and uses a route-handler BFF. This skeleton is the server-rendered kind (Next RSC +
middleware + cookie auth), so it follows commerce.

## Decision

**Adopt a same-origin BFF route handler as the default web transport, fed by a new
framework-agnostic `@repo/api-mocks` package.**

### 1. Shared, framework-agnostic mock routes (`@repo/api-mocks`)

Mock endpoints are plain `MockRoute` objects — `{ method, pattern, handler(ctx) }`
— with **no** MSW/Next/transport coupling. The package owns the router
(`matchPattern`/`findRoute`), response envelopes (matching
`apiErrorEnvelopeSchema`), the dispatcher (`resolveMock`/`runMock`/`executeRoute`),
in-memory fixtures + session, and an MSW adapter behind the `@repo/api-mocks/msw`
subpath (so importing the core never pulls MSW into a server bundle). It depends on
`@repo/validators`/`@repo/config` only — never `@repo/api` (it mirrors the wire
contract, not the client). One source of mock truth, three runtimes:

- **Web (server-side):** the BFF route handler dispatches routes via `resolveMock`.
- **Expo + Vitest:** `createMswHandlers(routes)` / `createTestServer(routes)`.

Response shapes match the documented backend contract exactly (login returns
`{ success, data }`, refresh `{ data }`, `/me` a bare user), so no automatic
envelope wrapping — handlers return their precise body and the dispatcher sends it
verbatim. Login sets the httpOnly refresh cookie; the in-memory session store is
keyed by it, with a cookie-less fallback (most-recent login) for runtimes that
don't carry the cookie (Expo MSW, Vitest). Configurable latency (`delayRange`)
exercises loading/race states.

### 2. One shared transport function, two runtimes (`handleApiRequest`)

The mock-or-proxy decision lives in one place — `handleApiRequest(request)`
(`apps/web/lib/route-handler/handle-api-request.ts`): when the dev mock is on it
dispatches the shared routes server-side (`runMock`); an **unmatched** request
falls through to the real backend (`backend-proxy.ts`) — partial mocking (mock
some groups, proxy the rest). With mocks off, everything proxies. The browser
reaches it over HTTP via the `/api/[...path]` catch-all (Node runtime). The
RSC/server client reaches the **same function in-process** — `createApiClient`
accepts an injected terminal `fetch` (`lib/server-api.ts`), so there is **no HTTP
self-hop**: `next build` works with no server up, RSC still sees mocks, and there
is no app-origin env to configure.

### 3. Transport base URL (amends ADR 0012)

The browser client uses `baseUrl: "/api"`. The RSC clients use an internal
sentinel base whose `pathname` the in-process handler reads — they never touch the
network or an app-origin env. ADR 0012's "per-runtime construction, no
module-global transport" is unchanged.

### 4. Proxy correctness

`backend-proxy.ts` streams request/response bodies (no buffering), returns the
upstream body directly so null-body statuses (`204`/`304`) don't throw, and copies
**every** `Set-Cookie` via `getSetCookie()` (the `Headers` iterator folds
multiples into one). It shares `stripApiPrefix` with the dispatcher so both
normalize paths identically.

### 5. Auth wiring is untouched (no ADR 0017 rework)

The proxy forwards the bearer + cookies, so the existing token-manager + injected
refresh/retry middleware keep working as-is. Both apps compose that stack via
`createClientMiddleware({ baseUrl })` (exported from `@repo/auth`), which returns
`[createRetryMiddleware(), createRefreshMiddleware({ baseUrl })]` in the one
correct order (retry OUTSIDE refresh, so a refreshed request is itself
retryable) — a single source for the invariant across web + mobile. Because login
sets the refresh cookie
**server-visibly** through the BFF, `proxy.ts` drops its MSW short-circuit and
gates under the dev mock exactly as it will against the real backend — closing the
gap the auth pass left open. The mock session resolves strictly by cookie under
the BFF (`cookieLess: false`); only cookie-less MSW runtimes (Expo/Vitest) use the
most-recent-login fallback (`cookieLess: true`).

## Consequences

- A developer can clone the skeleton and run the **entire** app — protected RSC
  routes, middleware gating, the full login → `/me` → refresh → logout flow, the
  users list + pagination — against mocks with **zero backend**, including a fully
  static `next build`.
- One extra hop in production for the **browser** (client → `/api` → backend);
  RSC has no hop (in-process). Accepted: it buys origin hiding, server-side
  credential handling, and dev/prod fidelity.
- New lint boundary: `api-mocks` may import `validators`/`config`/`utils` only;
  apps may import it; `@repo/api` still must not import `@repo/auth`.

## Mobile (deferred, unchanged stance)

Mobile keeps its direct-to-backend transport and stays dormant. It can adopt the
**same** `MockRoute[]` via `createMswHandlers` the moment `msw/native` graduates
from WIP — the shared-route seam makes that a one-step drop-in. We deliberately do
**not** pull the WIP `msw/native` dependency into the dormant Expo app now (ADR
0015/0016 stance). A Next BFF cannot serve Expo (no server), so web (BFF) and
mobile (MSW) consuming one route set is the correct asymmetry, not a gap.
