# @repo/api

REST data layer: a stable, generator-agnostic barrel over TanStack Query — an explicit `createApiClient` factory, typed endpoint builders, a query-key factory, and cache helpers (ADR 0007 / 0012).

## Exports

Server-safe barrel (`@repo/api`):

- `createApiClient` — explicit client factory; injectable `fetch`, `getToken`, `middleware`, `signal` (no module-global transport), plus an optional `envelope` seam (`unwrap` + `mapError`, ADR 0030) for backends that wrap every payload — endpoint code stays envelope-blind.
- `ApiError`, `parseRetryAfter` — error type + `Retry-After` parser.
- `isHttpError` / `isUnauthorized` / `isForbidden` / `isNotFound` / `isConflict` / `isValidation` / `isRateLimited` / `isServerError` / `isRetryable` / `isRetryableStatus` / `retryAfterMs` / `fieldErrors` / `errorContext` — error taxonomy + telemetry context.
- `createRetryMiddleware`, `createDebugMiddleware`, `getApiLog`, `clearApiLog` — retry/backoff/429 + dev request logger and its ring buffer.
- `makeQueryClient`, `getQueryClient` — QueryClient factory (per-resource `STALE`/`GC` tiers, optional `onError`) + the per-runtime singleton.
- `keys` — query-key factory.
- `queryOptions`, `mutationOptions` — plain TanStack option emitters.
- `invalidateKeys`, `optimisticUpdate` — cache invalidation + optimistic helpers.
- `defineQuery`, `defineMutation`, `defineInfiniteQuery` — endpoint builders.
- `createUsersQueries`, `createAuthQueries` — bound endpoint factories.
- `dehydrate`, `HydrationBoundary` — RSC-safe hydration (re-exported from TanStack).
- Types: `ApiClient`, `ApiClientConfig`, `ResponseEnvelopeConfig`, `ApiMiddleware`, `ApiRequest`, `ApiFetchOptions`, `ApiErrorKind`, `RetryOptions`, `DebugMiddlewareOptions`, `ApiLogEntry`, `MakeQueryClientOptions`, `OptimisticConfig`, `OptimisticContext`, `DefineQueryConfig`, `DefineMutationConfig`, `DefineInfiniteQueryConfig`.

Client-only surface (`@repo/api/react`, `"use client"`): `ApiProvider`, `useApiClient`, `useUsersQueries`, `useAuthQueries`, and re-exported `useQuery` / `useSuspenseQuery` / `useInfiniteQuery` / `useMutation` / `useQueryClient`.

## Usage

RSC prefetch then hydrate (mirrors `apps/web/app/page.tsx`):

```tsx
import { createUsersQueries, dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createPublicServerApiClient } from "../lib/server-api";

const qc = getQueryClient();
const usersQueries = createUsersQueries(createPublicServerApiClient());
await qc.prefetchQuery(usersQueries.list());
return <HydrationBoundary state={dehydrate(qc)}>{/* client leaf */}</HydrationBoundary>;
```

The client leaf reads the same options via `useUsersQueries().list()` + `useQuery` (`@repo/api/react`).

## Decisions

- [ADR 0007](../../docs/adr/0007-rest-data-layer.md) — REST data layer; stable barrel hides hand-written vs generated contracts.
- [ADR 0012](../../docs/adr/0012-api-client-factory.md) — explicit `createApiClient` factory; middleware + signal, no module-global transport.
- [ADR 0014](../../docs/adr/0014-error-handling-exceptions-at-the-data-seam.md) — exceptions at the data seam; no `Result` idiom.
- [ADR 0018](../../docs/adr/0018-bff-route-handler-and-shared-mocks.md) — pluggable terminal `fetch` lets RSC resolve the BFF in-process.
- [ADR 0019](../../docs/adr/0019-openapi-codegen-seam.md) — hand-written zod kept swap-ready for `@hey-api/openapi-ts`.
- [ADR 0021](../../docs/adr/0021-telemetry-observability-package.md) — `makeQueryClient({ onError })` is the telemetry DI seam.
- [ADR 0030](../../docs/adr/0030-api-response-envelope-seam.md) — response-envelope seam: `envelope.unwrap` (2xx, before `parse`) + `envelope.mapError` (non-2xx → `ApiError` fields).

## Adding a resource

`pnpm gen api-resource` — scaffolds the endpoint module and adds the export at the `@gen:exports` marker in `src/index.ts`.
