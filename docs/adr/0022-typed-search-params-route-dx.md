# ADR 0022 — Route DX: zod-typed search params + active-route helpers in `@repo/navigation`

**Status:** Accepted (2026-06-04). Extends [ADR 0003](0003-cross-platform-navigation.md)
(the in-repo route contract).

## Context

`@repo/navigation` (ADR 0003) gives typed **path** params off a const-asserted
registry, plus `Link` / `useNavigate` / `buildPath` for both platforms. Two DX
gaps remain for real apps:

1. **Search/query params are untyped.** Building `/users?page=2&sort=name` is
   stringly-typed, and reading them (web `useSearchParams`, mobile
   `useLocalSearchParams`) returns raw strings with no coercion or validation.
2. **No active-route matching.** Nav highlighting requires hand-matching
   `pathname` against templates with dynamic segments.

Path params today use a lightweight const-spec (`ParamKind = "string" |
"number"`). Search params want more — coercion (strings → number/boolean),
optionality, defaults, enums — which is exactly what a schema library provides.

## Decision

**Add zod-typed search params and active-route helpers to `@repo/navigation`,
with a direct `navigation → zod` dependency (not `navigation → @repo/validators`).**

- A registry entry may declare an optional `search` zod schema:
  `users: { path: "/users", search: z.object({ page: z.coerce.number().default(1),
sort: z.enum(["name","date"]).optional() }) }`.
- `Href` widens to carry a typed `query` inferred from the route's `search`
  schema; `Link` / `useNavigate` accept it; `buildPath` serializes it (reusing
  the existing `stableParams` ordering for stable URLs).
- A typed read hook — `useSearchParams(route)` — wraps web `useSearchParams` /
  mobile `useLocalSearchParams`, parses through the route's schema (coercion +
  defaults), and returns the typed object. Invalid params fall back to schema
  defaults rather than throwing (search params are user-editable).
- Active-route helpers: `isActive(href, pathname)` and `useActiveRoute()` match
  the current pathname against registry templates (dynamic segments included),
  for nav highlighting.

**Why `navigation → zod` directly, not `→ @repo/validators`.** `@repo/validators`
owns _data/domain_ contracts; `@repo/navigation` owns _route_ contracts. Search-
param shapes are part of the route contract, so colocating their schemas in the
registry is cohesive — not duplication of the validators domain. A direct zod
dependency keeps routing independent of the data layer and avoids a
`navigation → validators` edge. zod is already in both bundles (via `@repo/api` /
forms), so there is no added cost. If a search schema ever needs a heavy shared
primitive, that is the rare case to revisit — not the default.

**DAG (ADR 0011).** No new _internal_ edge: `zod` is external and not governed by
`eslint-plugin-boundaries`. `@repo/navigation` stays `→ {utils, config}`
internally; it gains `zod` as a package dependency.

## Consequences

- End-to-end typed routing: path **and** search params are typed at `Link` /
  `useNavigate` call sites and at read time, with coercion + defaults — a real
  DX win and fewer stringly-typed bugs.
- `@repo/navigation` takes on a small amount of runtime validation (parsing
  search params). This is a deliberate, cohesive responsibility-stretch (search
  params are routing), and the one boundary this ADR moves.
- Schemas live in the registry, so the route contract stays single-sourced; the
  same schema drives building, reading, and (optionally) documentation.
- A non-trivial `search` schema is opt-in per route; routes without one behave
  exactly as before (back-compatible with the ADR 0003 contract).

## Sources

- [ADR 0003](0003-cross-platform-navigation.md) (route contract this extends),
  [ADR 0008](0008-shared-package-boundaries.md) / [ADR 0011](0011-enforce-package-boundaries-with-eslint.md)
  (boundaries), [ADR 0009](0009-forms-rhf-zod-no-package.md) (zod as the chosen
  schema tool, reused here for route contracts).
- zod `coerce` / `enum` / `default` for search-param parsing:
  <https://zod.dev> (verified 2026-06-04).
