# ADR 0100 — Fixture-mutation → version-bump cutover (structural I3 immutability)

**Status:** Accepted (2026-07-03). Implemented (CAR-31).

## Context

During the core-hardening slices the dev fixtures (`catalog@1`/`@2`,
`sliding-gate@1`, `fence-run@1`) were edited **in place** under frozen
`id@version` handles — the correct dev convenience while the model iterated
(ADR 0095 geometry, ADR 0097 fill types). But published rows are immutable
(I3) and the seed was idempotent-SKIP, so an already-seeded DB kept the OLD
body forever. That drift produced the 2026-07-02 NO-GO (stale diagonal, a
2-fill body, a price table missing `lamela_113`) and the finding _"an
in-place edit to an immutable-versioned fixture never reaches an
already-seeded DB"_. ADR 0098's dev `seed:reset` gave the resync lever;
this ADR closes the loop **before FIL's first real stamped quote** — after
which a silent in-place mutation would break the I3 moat (byte-identical
reproduction, the stated trust feature) at the worst possible moment.

## Decision

Three mechanisms, each structural rather than convention:

1. **DB-layer immutability triggers**
   (`packages/db/migrations/20260703103023_immutable_store_guard`). BEFORE
   UPDATE triggers on the three I3 stores raise on any value change
   (`IS DISTINCT FROM`, so a no-op write passes) to the frozen columns:
   - `release`: `release_id`, `model_id`, `version`, `catalog_version`, `body`
   - `catalog_version`: `version`, `body`
   - `price_table`: `organization_id`, `version`, `currency`, `dph_rate`,
     `rounding_policy`, `table`, `cost` — exactly what
     `verifyReproducibility` re-derives against.

   Lifecycle metadata stays mutable: `release.status` (retire, ADR 0067),
   `release.initial_input` (publish metadata, not I3), `price_table`
   effective window (`resolveActive`) + `margin_floor_pct` (a guard, not a
   derivation input) + `owner_id` (audit ref). DELETE stays governed by the
   existing FK RESTRICTs (a quoted release/table cannot be deleted) plus the
   dev-only `seed:reset`, which production refuses.

2. **Seed drift detection** (`apps/api/src/seed.ts`). The silent
   skip-on-conflict becomes compare-then-skip: an existing row whose body
   matches the HEAD fixture logs "matches HEAD fixtures, skipping"; a
   mismatch is a **hard error** naming both remediations — bump the fixture
   version and publish it as a NEW release (the discipline from here on), or
   `pnpm --filter api seed:reset && pnpm --filter api seed` (dev resync).
   Drift can no longer be silent anywhere the seed runs.

3. **The documented dev loop.** While a model slice iterates locally,
   in-place fixture editing remains cheap: edit → `seed:reset` → `seed`
   (nothing real references dev rows; the FK RESTRICT makes `seed:reset`
   refuse once quotes exist, which is exactly the boundary). The moment a
   release is real (any org's quote stamps it), the only path for a model
   change is a **version bump** through the existing lifecycle: publish
   `model@N+1` → assign → lazy-pin/upgrade-offer → tenant opt-in
   (ADRs 0064–0067) — e.g. the CAR-18 leaf fixes ship as `sliding-gate@2`,
   never as edits to `@1`.

## Consequences

- No path exists — raw SQL included — for a published body to change in
  place; a compromised or careless writer gets a loud `immutable (I3)` error.
- Migrations that MUST rewrite a store body (none anticipated) would have to
  drop/recreate the trigger explicitly inside the migration — a visible,
  reviewable act, which is the point.
- The frozen set is an explicit allowlist, so a column ADDED to an I3 store
  later is **mutable by omission** (the right default for lifecycle metadata,
  the wrong one for a derivation input). Adding a column to `release`,
  `catalog_version`, or `price_table` requires deciding its class and, for a
  frozen one, extending the trigger in the same migration.
- The authoring editor (ADR 0068) is unaffected: publish was already
  insert-only through the one immutable `POST /v1/releases` path.
- Goldens and the delta-0 harness are untouched (`@repo/fixtures` at HEAD
  remains the test-side source; the guard governs the DB copies).
- Covered by `releases.itest.ts` + `price-tables.itest.ts` trigger cases
  (tamper → raise; lifecycle write → pass).
