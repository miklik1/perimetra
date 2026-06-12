# ADR 0012 — API client as an explicit factory (no module-global transport)

**Status:** Accepted (2026-06-01) — refines [ADR 0007](0007-rest-data-layer.md).
The transport contract (owned `apiFetch` over global `fetch`, one normalized
`ApiError`, `queryOptions`/keys consumption, selective zod) is unchanged. This
ADR changes only **how the transport is constructed and consumed**: from a
mutable module-global to a per-runtime factory.

## Context

ADR 0007 shipped the transport as a module-level singleton: `configureApi(cfg)`
mutated a module-global `config`, which `apiFetch` read ambiently. Each app ran
a side-effect `lib/api-init.ts` to call `configureApi` at startup, and endpoint
modules (`usersQueries`) read the global implicitly.

This has three problems for a reference skeleton:

1. **Mutable global state.** A singleton configured by a side-effect import is
   order-dependent and easy to use before it is set (`apiFetch called before
configureApi()` was a real, reachable error). It also makes tests stateful.
2. **Server/client ambiguity on web.** Next's RSC server and the browser are
   separate module graphs, so the global had to be configured **twice** (server
   in `layout.tsx`, client in `providers.tsx`) — duplicated, and fragile if a
   prefetch ran before the client render configured its copy.
3. **No extension point.** Cross-cutting transport concerns (logging, retry,
   401-refresh) had nowhere to live without growing the global.

## Decision

**`createApiClient({ baseUrl, getToken, middleware })` returns a bound
`ApiClient` (closure, no module state). Each runtime builds and owns its own
client; endpoints and React glue take the client explicitly.**

- **`createApiClient` → `{ apiFetch }`.** All transport behavior from ADR 0007
  is preserved inside the closure (base-URL resolution, JSON + bearer headers,
  204/parse/error normalization to one `ApiError`).
- **Middleware chain.** `middleware: ApiMiddleware[]` composes around the
  terminal `fetch` (first entry outermost). Each `(req, next) => Response` may
  mutate the request, short-circuit, or post-process — the home for logging /
  retry / refresh. Empty chain = direct `fetch`.
- **Cancellation is first-class.** `ApiFetchOptions` carries `signal`; it flows
  into `fetch` and every middleware. TanStack passes `signal` into each
  `queryFn`, so endpoints forward it for free.
- **Endpoints are factories.** `createXQueries(client)` (e.g. `createUsersQueries`)
  return the same `queryOptions` shape as ADR 0007 — framework-agnostic, usable
  on the server and client.
- **React surface (`@repo/api/react`).** `<ApiProvider baseUrl getToken
middleware>` builds the client + a `makeQueryClient()` via `useState`
  initializers (run once, no ordering hazard) and provides both via context.
  `useApiClient()` reads it; thin per-endpoint hooks (`useUsersQueries()`)
  bind the endpoint factory to the context client. An optional
  `initialQueryClient` prop (read once at mount) allows seeding (tests, SSR).
- **Per-runtime construction.** Browser and RN each build their client inside
  `<ApiProvider>` (RN keeps `useState(makeQueryClient)`, not `getQueryClient` —
  ADR 0007 / query-client note). The Next RSC server builds its own via
  `apps/web/lib/server-api.ts` (`createServerApiClient()`) for prefetch. The two
  web clients are _intentionally distinct_ — server reads the request cookie,
  browser reads its own token source — not duplication.
- **No `lib/api-init.ts`.** Both apps' side-effect init files are retired.

## Consequences

- No mutable module-global; "use before configure" is unrepresentable.
- Web server prefetch and client hydration each have a correctly-configured
  client without double-configuration; `keys` stay shared so cache keys match.
- Transport is extensible (middleware) and cancelable (signal) without touching
  call sites; the OpenAPI-vs-hand-written barrel contract (ADR 0007) is intact —
  a generated `createXQueries(client)` would drop in unchanged.
- Slightly more wiring than a global (apps pass `baseUrl`/`getToken`; the RSC
  path builds a client) — accepted as the cost of explicitness and testability.
- Multi-service scale is trivial: call `createApiClient` again for a second API.

## Sources

- https://tanstack.com/query/v5/docs/framework/react/guides/query-cancellation (queryFn `signal`)
- https://tanstack.com/query/v5/docs/framework/react/guides/advanced-ssr (per-request server client; HydrationBoundary)
- [ADR 0007](0007-rest-data-layer.md) (transport contract + consumption pattern), [ADR 0008](0008-shared-package-boundaries.md) (package boundaries)
