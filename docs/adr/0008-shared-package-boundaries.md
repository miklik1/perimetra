# ADR 0008 — Shared package boundaries: separate api / validators / utils / config from the start

**Status:** Accepted (2026-05-26) — refines [ADR 0007](0007-rest-data-layer.md)
(supersedes its "zod inside `@repo/api`, split validators later" and
"`makeQueryClient` in `@repo/shared`" framing)

## Context

This skeleton is reused across many **midscale** projects for years. Earlier
framing optimized for "start minimal, split later": keep zod inside `@repo/api`,
keep a single `@repo/shared` grab-bag, and split a `@repo/validators` /
validation/env package out "only if needed" (ADR 0007 §validators;
ARCHITECTURE "Not yet decided"). For a long-lived base that is the wrong default:

- The split-later tax is paid **per project** (move code, rewire imports, churn a
  shared base everyone tracks) — far more expensive than establishing clean
  boundaries once.
- A `@repo/shared` grab-bag invites coupling and import cycles; "shared" is not a
  responsibility.
- The two platforms already validate env asymmetrically (web `@t3-oss/env-nextjs`,
  mobile raw zod) — a real source of drift today.

create-t3-turbo itself separates `packages/{api,auth,db,ui,validators}` rather
than one shared package. We adopt the same discipline, scaled to our REST/no-DB
shape.

## Decision

**One responsibility per package, explicit acyclic deps, no grab-bag, no
"split later."** Runtime libraries in `packages/`:

- **`@repo/validators`** — zod schemas + the types they infer. The single source
  of runtime contracts. No transport, no React. Consumed by `@repo/api` (DTO
  parsing at trust boundaries) **and** by app-side form validation.
- **`@repo/utils`** — logger + formatting (date/number/currency/string) + generic
  helpers (assert/guard/etc.). Pure TS, platform-neutral, no React, no zod.
  (A `Result` idiom was removed — see [ADR 0014](0014-error-handling-exceptions-at-the-data-seam.md):
  failure is modelled with exceptions at the data seam, not a `Result` type.)
- **`@repo/config`** — typed env + app config: `@t3-oss/env-*` schema(s) and
  per-platform access (web `env-nextjs`, mobile `env-core`), plus shared
  constants. Replaces the asymmetric per-app env validation.
- **`@repo/api`** — the REST data layer of [ADR 0007](0007-rest-data-layer.md):
  owned `apiFetch` + normalized `ApiError`, hierarchical query-key factory,
  `queryOptions`/`mutationOptions`, endpoint modules — **plus** the TanStack
  Query client/provider helpers (`makeQueryClient()` / `getQueryClient()`).
  Depends on `@repo/validators` (schemas), `@repo/utils` (logger),
  `@repo/config` (base URL / env). ADR 0007's transport + consumption design is
  unchanged; only the home of zod and the query client moves.
- **`@repo/ui`** — web-only shadcn DOM ([ADR 0006](0006-split-ui-web-dom-mobile-rn.md)).

**Retire `@repo/shared`** — its only content (`makeQueryClient`) moves into
`@repo/api`. No catch-all package.

**Build/config packages stay in `tooling/`** (not shipped): `eslint-config`,
`typescript-config`, `tailwind-config`, `prettier-config`, `github`. (Relocate
`eslint-config` + `typescript-config` from `packages/` into `tooling/` for
consistency — they are config, not runtime.)

**Dependency direction is acyclic:** apps → `@repo/{api,ui,validators,utils,config}`;
`@repo/api` → `{validators, utils, config}`; `@repo/validators` may use `@repo/utils`;
nothing depends on an app; no cycles. Mobile RN UI stays in `apps/mobile`
(ADR 0006).

**New cross-cutting concerns** (auth, storage/persistence, telemetry, i18n,
feature flags) each get their **own** package when first introduced — neither
stubbed empty up front nor crammed into an existing package.

## Consequences

- Clean import boundaries and an acyclic graph; validation can't drift from
  transport because both reference `@repo/validators` types.
- More packages to wire (catalog entry + tsconfig + eslint per package) — a
  bounded one-time cost, paid once for the multi-year base instead of per project.
- The ARCHITECTURE "Not yet decided" items for shared validation and env
  unification are now decided here.
- A project that genuinely needs less can delete a package; that is cheaper and
  rarer than the split-later churn this avoids.

## Sources

- create-t3-turbo `main` (verified 2026-05-26): `packages/{api,auth,db,ui,validators}`,
  `tooling/{eslint,prettier,tailwind,typescript,github}` separation.
- [ADR 0006](0006-split-ui-web-dom-mobile-rn.md) (web/mobile UI split),
  [ADR 0007](0007-rest-data-layer.md) (data layer design this refines).
