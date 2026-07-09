# ADR 0104 — Deployment tier derived from `VERCEL_TARGET_ENV`: mock gate keys off the tier, not `NODE_ENV`; guard at build AND runtime

**Status:** Accepted (2026-07-07). Implemented.

> Drained from **skeleton ADR 0046** (channel A, `6f9a43d`) and renumbered —
> perimetra's 0046 is catalog/role resolution. Future upstream commits citing
> "ADR 0046" in web-config or mock-gate code refer to THIS decision.

First proven downstream in Primat Plus (its own ADR 0047 — a different project's
numbering, unrelated to perimetra's 0047 error taxonomy); the generalized subset
is authored upstream in the skeleton as the source of truth.

## Context

The dev-mock / data-source gates keyed off `NODE_ENV !== "production"`. That is
broken on any platform that builds a non-production deploy with
`NODE_ENV=production` — which is **every Vercel deploy**: Vercel builds a
_preview_ deploy with `NODE_ENV=production` too. A `NODE_ENV` gate therefore
cannot tell preview from prod: it silently kills mocks on a preview URL, and it
is one careless env-scope copy away from leaking a mock to prod. This is a
mock-leak-to-prod / prod-serving-stale-mock class of bug — security-adjacent.

The same broken conjunct existed at **three** call sites, all of which must
agree on who serves `/api/*`:

- `apps/web/lib/route-handler/handle-api-request.ts` — the BFF mock gate.
- `apps/web/app/page.tsx` — the home-page RSC prefetch gate (`hasDataSource`).
- `apps/web/next.config.js` — the `rewrites()` mock mirror (fullstack only; it
  must stay in lockstep with the route handler or the `/api/auth/*` +
  `/api/v1/*` rewrites bypass the mock route).

`VERCEL_ENV` is not a fix either — it collapses a Custom Environment (`stage`)
to `"preview"`. `VERCEL_TARGET_ENV` surfaces the literal environment name at
BOTH build and runtime and is the correct single signal (vault finding
"Multi-tier Vercel (Next) deploy …", 2026-07-02).

## Decision

**Derive a deployment tier and read it everywhere.**
`packages/config/src/env/web.ts` exports `resolveTier(vercelTargetEnv,
appTierOverride): "preview" | "stage" | "prod"` and a computed `TIER`. Every
mock/data-source gate now reads `TIER !== "prod"` instead of `NODE_ENV`.

Precedence (derivation, never hand-set, so tier and environment stay
structurally inseparable):

1. `VERCEL_TARGET_ENV` wins whenever present — the tier is not hand-overridable
   on Vercel. `"production"` → `prod`, `"stage"` → `stage`, anything else
   (`preview` / `development` / a custom env) → `preview` (fail-safe: an unknown
   environment is never live).
2. else `APP_TIER` — a **manual override for the NON-Vercel deploy path only**:
   this skeleton's platform-agnostic container/standalone image
   (`docs/operations/deploy.md`) never sets `VERCEL_TARGET_ENV`.
3. else `"preview"` — the safe default (mocks stay possible until `API_URL` is
   set; preserves the existing tri-state fallback).

This is a two-arg **extension** of Primat's single-arg `resolveTier` (Primat
Plus ADR 0047), not a verbatim port: the `appTierOverride` arg exists solely because this
skeleton has a non-Vercel deploy path — Primat is Vercel-only and never needed
it.

**Guard at build AND runtime.** `packages/config/src/env/assert-tier-invariants.ts`
runs at `next.config.js` load-time (both apps) so a tier/env contradiction FAILS
`next build` before any chunk is emitted — the build-time half; the `TIER` gates
are the runtime half. It is imported by **package self-reference**
(`@repo/config/env/assert-tier-invariants`) because a relative extensionless
`.ts` path does not resolve under next.config's Node ESM loader (finding lesson
2); the subpath is added to `packages/config`'s `exports` map and the ESLint
deep-import allow-list.

The guard is the **minimal generalized subset**: on `prod` forbid
`NEXT_PUBLIC_ENABLE_MSW="true"` and require `API_URL`; on `preview` see the
perimetra deviation below; refuse
`SKIP_ENV_VALIDATION` on ANY prod-tier build — a Vercel `VERCEL_TARGET_ENV=production`
target OR the non-Vercel `APP_TIER=prod` container/standalone build (keying the
refusal only on the Vercel var would let the container prod path skip the whole
guard); and a defense-in-depth check that a Production Vercel target resolves
`TIER=prod`. `resolveTier` and that belt normalise `VERCEL_TARGET_ENV`
(trim + lower-case) so a mis-cased override can't silently fall through to the
`preview` tier (the mock-leak-to-prod direction) on a real Production target.
`stage` carries no hard constraints yet.

**Scope.** Only the generalized tier + mock-gate fix + minimal build-time guard.
Primat's slice-mix / stage-mix / password-login machinery stays Primat-local
(Primat Plus ADR 0047) — it does not exist in this skeleton. `stage` exists so derived
projects that add slices inherit the enum, not because the skeleton mixes.

## Perimetra deviation — the `preview`-tier invariants

The upstream guard forbids `API_URL` on `preview` outright, reasoning that
"unmatched routes must fall through to the mock, not a real catch-all". That
rule is correct **for the skeleton**, which is a mock-first demo: its preview
deploys are meant to serve fixtures and have no backend at all.

Perimetra is a real-backend product. Local development, preview deploys and
production all point at a real api (`API_URL=http://localhost:4002` locally).
Taking the upstream rule verbatim makes `assertTierInvariants` throw at
`next.config.js` load in every environment we actually have, so `next build` —
and therefore `pnpm build`, the repo's definition of done — can never pass. This
was proven, not predicted: the drained guard failed the web build immediately.

The hazard the upstream rule protects against is an **ambiguous data source on a
non-live tier**. Perimetra keeps that protection and drops the mock-first
assumption, so on `preview`:

- `NEXT_PUBLIC_ENABLE_MSW="true"` **together with** a set `API_URL` is refused.
  `mocksEnabled` makes the mock win at the BFF, so the configured backend origin
  is silently ignored — a reviewer reads fixtures believing they read staging.
- `NEXT_PUBLIC_ENABLE_MSW="false"` **with** `API_URL` unset stays refused (the
  upstream rule, kept verbatim): the BFF would proxy its `http://localhost:4000`
  default.
- Both unset stays legal — the documented fresh-clone full-mock fallback, which
  `next dev` must keep working.

Everything else drains verbatim. The mock-leak-to-prod protection this ADR
exists for — tier derivation, the `prod`-tier invariants, the
`SKIP_ENV_VALIDATION` refusal, and the `TIER !== "prod"` gates at all three call
sites — is unchanged. The deviation is confined to the tier that is never live.

The general lesson (recorded as a vault engineering finding): a skeleton
invariant that encodes the skeleton's own product posture will break every
derived project that does not share it, and it breaks at drain time, in the
build, not in review.

## Consequences

- Two new server env vars: `VERCEL_TARGET_ENV` (Vercel-system-set, never manual)
  and `APP_TIER` (manual, the non-Vercel path only), documented in
  `apps/web/.env.example`.
- New public subpath `@repo/config/env/assert-tier-invariants` (exports map +
  ESLint allow-list, kept in lockstep).
- Tests: `resolveTier` per-branch incl. the `APP_TIER` fallback precedence;
  `TIER` pinned to `preview` for the exact Vercel-preview shape
  (`VERCEL_TARGET_ENV=preview`, `NODE_ENV=production`); a behavioral fail-first
  gate test proving the route handler keeps mocks ON on preview and OFF on prod
  (even with `NEXT_PUBLIC_ENABLE_MSW=true`); `assertTierInvariants` violation
  cases; source-read guards pinning the config + page gates against a silent
  revert to `NODE_ENV`.
- Derived repos inherit this via the baseCommit drain trigger (a separate wave),
  not by this change.

## Sources

- Vault finding: "Multi-tier Vercel (Next) deploy — derive the tier from
  `VERCEL_TARGET_ENV`, not `NODE_ENV`; gate at build AND runtime" (2026-07-02).
- Primat Plus ADR 0047 — the richer downstream reference (full three-tier matrix
  - slice-mix machinery) if a future stage-mix pattern is wanted.
