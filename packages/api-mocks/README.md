# @repo/api-mocks

Framework-agnostic mock routes (`MockRoute[]`) + a dispatcher, with an MSW adapter behind a subpath — served server-side by the web BFF route handler and client-side by Expo/Vitest (ADR 0018).

## Exports

Core barrel (`@repo/api-mocks`) — no `msw` import, so the Next BFF never pulls MSW into a server bundle:

- `matchPattern`, `findRoute` — route pattern matching.
- `executeRoute`, `runMock`, `resolveMock`, `stripApiPrefix` — the dispatcher (`MockDispatchConfig`).
- `errorEnvelope`, `dispatchMockError` — error-response helpers.
- `MockHttpError` — throwable mock error.
- `authRoutes` — the auth handler route group.
- `routeGroups`, `selectRoutes`, `allRoutes`, `createMockConfig` — route-group selection + config assembly.
- `listMockUsers`, `resetSessions` — fixture access + test reset.
- Types: `MockRoute`, `MockMethod`, `MockHandler`, `MockRequestContext`, `MockRouteResult`, `MockResponse`.

MSW adapter (`@repo/api-mocks/msw`): `createMswHandlers(routes)` — turns `MockRoute[]` into MSW `RequestHandler[]` for the client/Node runtimes (Expo dev, Vitest) that can't host the Next BFF.

## Usage

Server-side dispatch inside the web BFF route handler (mirrors `apps/web/lib/route-handler/handle-api-request.ts`):

```ts
import { createMockConfig, resolveMock } from "@repo/api-mocks";

const config = createMockConfig();
const response = await resolveMock(request, config);
```

Client/Node runtimes register MSW handlers instead: `createMswHandlers(allRoutes)` from `@repo/api-mocks/msw`.

## Decisions

- [ADR 0018](../../docs/adr/0018-bff-route-handler-and-shared-mocks.md) — same-origin BFF route handler + shared mocks (server-visible); MSW only for client/Node runtimes.
- [ADR 0008](../../docs/adr/0008-shared-package-boundaries.md) — single-responsibility package; depends on `@repo/validators` + `@repo/config` only.

## Adding a resource

`pnpm gen api-resource` — scaffolds the mock route handler and adds the export at the `@gen:exports` marker in `src/index.ts`.
