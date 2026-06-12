# ADR 0007 — REST data layer: stable `@repo/api` barrel, OpenAPI-or-hand-written behind it

**Status:** Accepted (2026-05-26) — package-boundary specifics refined by
[ADR 0008](0008-shared-package-boundaries.md): zod schemas live in
`@repo/validators` and `makeQueryClient` in `@repo/api` (not `@repo/shared`).
Transport **construction** refined by [ADR 0012](0012-api-client-factory.md):
the owned `apiFetch` is now built by a `createApiClient` factory (+ middleware,
AbortSignal) instead of a module-global `configureApi`. The transport contract
and consumption design below are unchanged.

## Context

The backend is a separate PHP project, so there is no tRPC and no shared
server. The skeleton is reused across many projects: **some PHP backends expose
an OpenAPI/Swagger spec, some do not.** The data layer must support both with no
change to app-side consumers, because rework-per-project is the cost we are
trying to avoid for a multi-year base.

Naive unifier ("everything consumes zod; OpenAPI projects generate zod") is
right as an _interface_ but wrong if it forces zod-from-OpenAPI as mandatory:
generated zod never matches hand-written zod in shape, so "identical downstream"
is only true at the **type** level. The honest unifier is the exported
TypeScript type (`z.infer` / generated type) plus a **`queryOptions()` /
`mutationOptions()` consumption pattern**, with runtime zod as an _optional_
validation layer at trust boundaries — not the mandatory product of codegen.

Tooling verified 2026-05-26 (npm/GitHub): `@hey-api/openapi-ts` 0.97.3 (2.78M
wk, daily releases, zod v4 default, emits framework-agnostic `queryOptions`,
optional zod validation) is the highest-momentum maintained generator.
`openapi-typescript` + `openapi-fetch` + `openapi-react-query` (types-only, no
runtime validation) is the well-maintained minimal alternative. **`orval`** is
healthy but generates hooks by default (against the 2026 options-over-hooks
direction) and has zod split-mode bugs. **`openapi-zod-client` and `zodios` are
effectively dead** (zod v3 / no releases in ~12mo) — do not adopt.

The transport must behave identically in a Next.js 16 RSC server render, the
browser, and Hermes — all expose a WinterCG `fetch` (Expo installs a
WinterCG-compliant global `fetch`), so a thin wrapper over global `fetch` is the
only thing guaranteed uniform across all three.

## Decision

**Single `@repo/api` package exposing a stable public barrel. App code imports
only from `@repo/api` and never knows whether the contract was generated or
hand-written.**

- **Transport = an owned `apiFetch` wrapper (~40 lines) over global `fetch`**,
  not openapi-fetch / ofetch / ky. Owns: base-URL from env (`*_API_URL`,
  per-platform), auth-header injection (token getter passed in, so web
  cookies vs RN SecureStore stay app-side), JSON encode/decode, and **one
  normalized `ApiError` shape** (the error model). Same transport for both
  project types — no divergence, no upstream churn.
- **Consumption pattern = `queryOptions()` / `mutationOptions()` + a
  hierarchical, const-asserted query-key factory** (`keys.users.detail(id)`).
  Hand-write these thin wrappers; **do not generate hooks** — that keeps call
  sites stable across a generator swap and across both project types. The same
  `queryOptions` object feeds `useQuery`, `useSuspenseQuery`, and
  `queryClient.prefetchQuery()` for RSC hydration.
- **OpenAPI projects (default tool):** `@hey-api/openapi-ts` (`~0.97.x`, devDep)
  with `zod` (Zod 4) + `@tanstack/react-query` + `@hey-api/sdk` plugins,
  targeting the owned `apiFetch` as custom client. Output lands in
  `endpoints/generated/`.
- **Non-OpenAPI projects:** hand-write zod schemas + `queryOptions` factories in
  `endpoints/` with the **identical exported names/signatures**.
- **`@repo/api/index.ts` is a stable barrel** re-exporting the same surface
  (types, `queryOptions`, keys, `ApiError`) either way. The opt-in is purely
  which files are authored-vs-generated + presence of `openapi-ts.config.ts`.
- **Runtime validation is selective**, not blanket: validate at trust
  boundaries (auth, money, form input) and known-flaky endpoints; type-only
  elsewhere to avoid perf cost and brittle failures on benign additive changes.
- **zod schemas live in `@repo/validators`** (a dedicated package — see
  [ADR 0008](0008-shared-package-boundaries.md)); `@repo/api` imports them for
  trust-boundary parsing, and app forms import the same schemas, so validation
  and the types it infers cannot drift.
- **TanStack Query**: one `makeQueryClient()` (in `@repo/api`) used by
  both the RN `QueryClientProvider` and the Next `getQueryClient()`
  (request-scoped on server, singleton in browser). RSC: prefetch with the
  shared `queryOptions`, wrap in `<HydrationBoundary state={dehydrate(qc)}>`.
- **Turborepo**: add a `codegen` task that runs `openapi-ts` only in packages
  that have `openapi-ts.config.ts`; wire it as a `build` dependency. Non-OpenAPI
  projects simply have no codegen task.

## Consequences

- App-side `useQuery` / `useMutation` call sites, query keys, and the error type
  are byte-for-byte identical whether a project is OpenAPI or hand-written, and
  survive a future generator swap.
- One tool (hey-api) covers types + optional validation + query layer for
  OpenAPI projects; hand-written projects mirror its exports.
- Owned transport = zero per-project surprises and no exposure to transport-lib
  churn (e.g. ofetch v2 alpha).
- Pre-1.0 `@hey-api/openapi-ts` is pinned tight (`~0.97.x`) and bumped
  deliberately.
- Fallback (plan B): a strictly types-only project may use
  `openapi-typescript` + `openapi-fetch` + `openapi-react-query`, accepting that
  it splits the transport layer from the hand-written path — only when zero
  runtime validation + minimal footprint is a hard requirement.

## Sources

- npm/GitHub verified 2026-05-26: `@hey-api/openapi-ts` 0.97.3; `orval` 8.12.3;
  `openapi-typescript` 7.13.0 / `openapi-fetch` 0.17.0; `openapi-zod-client`
  1.18.3 (2025-02, stale); `zodios` (abandoned).
- https://heyapi.dev/openapi-ts/plugins/zod (Zod 4 default, schema split)
- https://heyapi.dev/openapi-ts/plugins/tanstack-query (queryOptions/keys/mutations)
- https://openapi-ts.dev/openapi-react-query/ ; https://orval.dev/docs/guides/zod/
- https://github.com/orval-labs/orval/issues/2933 (zod split-mode bugs)
- https://docs.expo.dev/versions/latest/sdk/expo/ (WinterCG global fetch)
- https://tanstack.com/query/v5/docs/framework/react/reference/queryOptions
- https://www.saschb2b.com/blog/typesafe-api-codegen-2026 (options-over-hooks)
