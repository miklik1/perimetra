# @repo/navigation

Typed cross-platform route contract: one const route registry (path templates + zod-typed search params) plus `Link` / `useNavigate` / `useSearchParams` wrappers per platform (ADR 0003 / 0022).

## Exports

Contract (`@repo/navigation/contract`, also re-exported from the platform entries):

- `routes` — the const route registry; `RouteName` — its key union.
- `buildPath(href)` — substitute `:param` placeholders + serialize typed `query` (stable ordering via `@repo/utils`).
- `parseSearchParams`, `searchParamsToRecord` — parse a record through a route's `search` schema.
- `isActive`, `matchRoute` (`IsActiveOptions`) — active-route helpers.
- Types: `Href`, `ParamsOf<N>`, `SearchOf<N>`.

The default entry resolves per platform via conditional exports:

- `@repo/navigation` on web → `src/web.tsx` (`"use client"`): `Link`, `useNavigate`, `useSearchParams`, `useActiveRoute`, `usePathname`.
- `@repo/navigation` on native (Metro's `react-native` condition) → `src/native.tsx`: same surface over expo-router.

## Usage

Typed `<Link>` over the registry (mirrors `apps/web/app/page.tsx`):

```tsx
import { Link } from "@repo/navigation";

<Link to={{ route: "users" }} className="underline">
  {t("usersLink")}
</Link>;
```

`useNavigate().push({ route: "user", params: { id } })` and `useSearchParams("users")` share the same typed `Href`.

## Decisions

- [ADR 0003](../../docs/adr/0003-cross-platform-navigation.md) — per-platform routing + in-repo contract; no Solito.
- [ADR 0022](../../docs/adr/0022-typed-search-params-route-dx.md) — zod-typed search params + active-route helpers (`navigation → zod`, not validators).
- [ADR 0008](../../docs/adr/0008-shared-package-boundaries.md) — serialization single-homed in `@repo/utils` so URLs and API cache keys never disagree.

## Adding a route

`pnpm gen route` — registers the new entry at the `@gen:exports` marker in `src/routes.ts` and scaffolds the web page / mobile screen.
