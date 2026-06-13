# ADR 0053 — Quote lifecycle: immutable stores, stamps + snapshot, I3 reproducibility

**Status:** Accepted (2026-06-13). Implemented in step 6 slice 3 (CORE_SPEC §10),
I3 core (sub-slices a/b/d/e); project persistence + org retrofit + roles deferred.

## Context

CORE_SPEC §6 defines the quote as the frozen commercial artifact:
`Quote { stamps, snapshot }` where **I3 (eternal reproducibility)** requires that
any historical quote re-derive byte-identically from its stamps (release ids +
catalog version + price-table version + override set). Steps 1–5 built the pure
core (`@repo/model`/`engine`/`renderers`); slices 1–2 (ADR 0051/0052) built the
browser-hosted configurator + site canvas, fed by the interim `@repo/fixtures`
source. This slice productizes the quote: it persists the engine's versioned
inputs immutably and freezes a re-derivable snapshot — the I3 mechanism.

The whole §10-step-6 quote-lifecycle slice is large (persistence + commercial
guardrails + tenancy + roles); it is cut into independently-shippable
sub-slices. This ADR records the I3-core decisions (a/b/d/e) and the seams the
remaining sub-slices fill.

## Decision

1. **Immutable, global, append-only vendor stores (releases + catalog-versions).**
   `release` (keyed by `releaseId` = `"modelId@version"`, the stamp handle) and
   `catalog_version` (keyed by `version`) persist the full `ProductModelRelease`
   / `Catalog` as JSONB. They are **global** (no owner/tenant scope — vendor
   data) and **append-only**: no update or delete repository surface, and
   re-publishing a version is a `409` (I3 — a stamped version must persist
   forever). Publish runs the same gate the fixtures harness runs —
   `@repo/model` `validateRelease` against the named catalog version (I2/ADR
   0047); a release with defects cannot ship. `@repo/db` stays decoupled from
   `@repo/model` — bodies are `jsonb` typed precisely only at the apps/api edge.

2. **Per-tenant versioned price tables with effective-date windows.**
   `price_table` is owner-scoped (ADR-0041 seam), append-only, `(owner, version)`
   unique. `resolveActive(asOf)` selects the window covering the instant
   (`effectiveFrom <= asOf < effectiveTo`, open-ended when null) — no yearly
   clones (CORE_SPEC §6). The engine `PriceTable` lives in the `table` JSONB as
   a **pure data argument** (numeric prices, ADR 0045 — NOT money-string;
   money crosses I10 only as result totals). `currency` / `marginFloorPct` /
   `dphRate` / `reverseCharge` are the §6 commercial guardrails, **app-layer**
   concerns (margin floor at issue, DPH at invoice) — never inside the
   deterministic engine.

3. **Quote = engine `SiteStamps` verbatim + a frozen `snapshot`.** `issue` runs
   the SAME pure `deriveSite` the configurator runs (I1/I4), server-side,
   resolving releases + catalog + the active price table from the immutable
   stores; the authoritative snapshot is computed server-side so it can never
   drift from a client. `stamps` is `result.stamps` copied verbatim. `snapshot`
   stores the frozen outputs (`bom`/`totals`/`money`/`cutList`/`drawings`) PLUS
   the minimal re-derivation seed — the **raw** per-instance `ConfigInput` +
   `CascadeLayers` + the `Site` graph + the stamped `kerfMm` (raw-input +
   overrides + stamped versions is the complete, minimal seed; the cascade
   re-runs deterministically). `totalMoney` (decimal string, I10) +
   `catalogVersion`/`priceTableVersion` are denormalised for queries.

4. **I3 verification is a first-class path, not an aspiration.**
   `verifyReproducibility` reloads the EXACT immutable inputs the stamps point at
   (release bodies by releaseId, catalog by version, price table by version),
   re-runs `deriveSite` + the renderers with the stamped kerf, and deep-equals
   every artifact against the frozen snapshot. Comparison is `isDeepStrictEqual`
   (order-independent — Postgres JSONB does not preserve object key order;
   arrays stay ordered) and string-exact on money. It ships as the
   `quotes.itest` acceptance test on the golden quote (total `129891.504`).

5. **The rebuild-core packages become BUILT (NodeNext dist) packages.** To run
   the pure engine server-side (the I3 mechanism), `@repo/model`/`engine`/
   `renderers`/`fixtures` move from source-only (`exports: ./src/index.ts`,
   bundler-consumed by web) to built `dist` packages like `@repo/db`/
   `@repo/validators` — node cannot load their `.ts` source at runtime. Their
   relative imports gain `.js` extensions (NodeNext); web now consumes `dist`
   too. This is required, not optional: a source-only import of `@repo/model`
   would crash the deployed api despite tsc passing.

6. **Owner-scoping is the ADR-0041 interim; quotes carry CZK now.** New
   commercial resources (price-tables, quotes) are owner-scoped via the single
   `scoped()` seam; the org-scope retrofit flips every module's `scoped()` +
   activates auth in ONE coordinated change (the playbook's intent), pending.
   `currency` is stored (CZK/EUR) but only CZK is exercised; the DPH /
   reverse-charge MATH (tax-correctness-sensitive) is deferred to the first
   cross-border tenant. `projectId` on a quote is nullable — a quote freezes a
   transient site until project persistence lands.

## Consequences

- **Deferred sub-slices (clean follow-ups, not regressions):** (c) project
  persistence — `project.site` + a `project_instance` roster, and retiring the
  `@repo/fixtures` runtime import in `apps/web` (the ⌛ remains); the org-scope
  retrofit across all modules (ADR 0041); roles (admin/sales/workshop) +
  workshop price-blind response DTOs + the margin-floor issue guard;
  customer-agreement entity for customer-scope overrides; EUR DPH math. The
  publish endpoints are authenticated-only until the admin RoleGuard lands.
- **I3 holds only while the stamped rows are immutable.** Enforced by the
  absence of an update/delete surface + the `409` re-publish guard. Residual
  risk: a `user` hard-delete cascades (`owner_id` FK `ON DELETE CASCADE`) to that
  user's price tables AND quotes (the frozen artifacts) — acceptable under
  owner-scoping (deleting the owner discards their data; the GDPR erasure path
  anonymises via `UPDATE`, never `DELETE`), resolved by the org-scope retrofit
  (these become org-owned, FKs move to `RESTRICT`). A check for that retrofit.
- **I3 verification compares the I10 money STRINGS, never the raw internal
  floats.** Two hardenings (from the slice's adversarial review) make the
  deep-equal sound across the JSONB round-trip: it canonically sorts the roster
  by `instanceId` at both issue and re-derivation (Postgres JSONB drops object
  key order, which would otherwise flip the engine's order-sensitive `bom` /
  `sources` / `overrideIds` arrays), and it compares `money` / `totalPriceMoney`
  (canonical 15-sig strings) rather than the raw `totals` / `bom.totalPrice`
  floats (documented engine-internal, need not survive JSONB exactly).
- **Price-table resolution is deterministic:** `resolveActive` tiebreaks
  `effectiveFrom desc, version desc` so a given `asOf` always resolves to one
  table; a unique `(owner, effectiveFrom)` index is a deferred hardening.
- **Publish authz:** `POST /releases` + `/catalog-versions` are
  authenticated-only — the admin RoleGuard is deferred (roles slice). The
  global-store slot-poisoning risk this leaves is gated by there being no real
  tenants pre-launch; the RoleGuard closes it before launch.
- The quote derivation asserts all instances share ONE catalog version (a site
  has one catalog stamp, I3); a mixed-catalog roster is a typed `422`.
- An invalid site is a typed `422` (the engine is the gate, I5) — `issue` never
  freezes a partial snapshot.

## Sources

- CORE_SPEC §6 (the quote), §7 (tenancy/roles), §10 (build order), I1–I11.
- Builds on ADR 0045 (numeric domain), 0046 (catalog resolution), 0047 (error
  taxonomy / validateRelease gate), 0048 (cascade/overrides), 0049 (site graph),
  0050 (renderers), 0051/0052 (configurator/site canvas), 0041 (tenancy seam),
  0037 (transactional outbox/audit), 0039 (api semantics).
