# ADR 0019 — OpenAPI codegen seam (documented, not wired)

**Status:** Accepted (2026-06-03). Extends [ADR 0007](0007-rest-data-layer.md).

## Context

ADR 0007 chose a stable `@repo/api` barrel with hand-written zod contracts behind
it, and noted that OpenAPI projects default to `@hey-api/openapi-ts` (zod +
TanStack Query plugins). The skeleton hand-writes endpoints today
(`endpoints/users.ts`, `endpoints/auth.ts`) on the thin `defineQuery` /
`defineMutation` / `defineInfiniteQuery` builders. The question this ADR settles:
when a project has an OpenAPI spec, how does it swap the hand-written path for a
generator without churning call sites?

## Decision

**Keep hand-written zod now; keep the seam swap-ready; do not wire a generator.**
The hand-written layer is deliberately shaped to mirror generator output:

- **Contracts in `@repo/validators`** are plain zod schemas + inferred types —
  exactly what `@hey-api/openapi-ts`'s zod plugin emits. A generated
  `userSchema`/`User` drops in where the hand-written one is.
- **Endpoints emit `queryOptions`/`mutationOptions`/`infiniteQueryOptions` + const
  keys** via the builders (ADR 0007's options-not-hooks). The TanStack plugin emits
  the same option-producing shape, so consuming hooks
  (`useUsersQueries().list()`, `useInfiniteQuery(users.listPaged())`) are unchanged
  across the swap.
- **One transport seam.** Generated clients call a single fetcher; ours is
  `ApiClient.apiFetch` (`createApiClient`). A generator is configured to call the
  same `apiFetch`, so auth/retry/refresh/debug middleware (ADR 0012/0018) keep
  applying with no per-endpoint rework.

### The swap, when a spec exists

1. Add `@hey-api/openapi-ts` + an `openapi-ts.config.ts` targeting the spec, with
   the zod + TanStack Query plugins and a custom client that delegates to
   `createApiClient`'s `apiFetch`.
2. Generate into `@repo/validators` (schemas) and `@repo/api` (endpoints).
3. Delete the hand-written `endpoints/*` + the now-generated schemas; call sites
   and the builders stay put.

### Why not now

No spec exists yet, and a generator adds a build step + a large generated surface
that would dwarf the skeleton. The cost of waiting is ~zero because the seam is
already the generator's shape. This stays a documented upgrade path, not code.

## Consequences

- New endpoints are hand-written on the builders until a spec lands — cheap, and
  they double as the reference for what the generated output should look like.
- The builders + the `@repo/api` barrel are the stable boundary; a generator swap
  is an internal change behind it (ADR 0007), not an app-visible one.
