# ADR 0065 — Per-release catalog (mixed-version support)

**Status:** Accepted (2026-06-18). Implemented. Supersedes the single-catalog
clause of [ADR 0060](0060-api-served-catalog.md) (the web bundle's "one catalog
every release pins" loud throw) and the `upgrade_catalog_conflict` pre-flight of
[ADR 0064](0064-release-version-pin.md). This is the "real fix" both ADRs named as
deferred — different products (and different pinned versions of one product) may
now carry **different catalog versions** in one org.

## Context

A `ProductModelRelease` validates and derives against exactly ONE immutable
catalog version, pinned at publish (`release.catalog_version`, metadata on the
row — never in the I3 body). Until now the whole system assumed every release an
org configured together shared that one version:

- the engine's `deriveSite(site, instances, prices, catalog)` took a **single**
  `Catalog` and a scalar `SiteStamps.catalogVersion`;
- quote `issue` de-duped the roster's catalog versions and 422'd `mixed_catalog`
  on more than one;
- the web bundle threw loud if published releases pinned different versions;
- the ADR-0064 opt-in pre-flighted `upgrade_catalog_conflict` to stop a tenant
  pinning a version on a different catalog than its other products.

That assumption blocks the normal lifecycle: the moment the vendor ships
`catalog@2` (adding a new product family) while an org still runs a product on
`catalog@1`, the org cannot hold both — every cross-catalog state failed loud.

The decisive finding: **the engine is already per-instance.** `deriveSite` loops
the roster and calls `deriveInstanceDetailed(instance.release, …, catalog, …)`
once per instance; `resolveComponent(catalog, request)` reads whatever catalog it
is handed; connection constraints are geometric (`prefixScope` excludes
`price.*`) and pair derived _scopes_, never catalog data. So two instances on
different catalog versions are already independently derivable and still
constraint-checkable across a connection. The single-catalog assumption lived in
exactly two structural spots (the one `catalog` parameter + the scalar stamp) and
three policy guards — nothing deeper.

The hard constraint is I3 (eternal reproducibility): a quote must re-derive
byte-identically forever. Whatever replaces the scalar catalog stamp must record
the version **each release actually derived against** and reload them all on
verify.

## Decision

- **The engine resolves catalog per-release, keyed by release id.**
  `deriveSite(site, instances, prices, catalogs: ReadonlyMap<string, Catalog>)`.
  Each instance derives against `catalogs.get(instance.release.id)`. Keying by
  **release id** (not catalog version) needs no new field on the release body
  (which has no catalog version) nor on `SiteInstance`; releases sharing a version
  simply point at the same `Catalog` object (deduped upstream). `deriveInstance`
  (single-release) keeps its one `catalog` argument and scalar `Stamps` —
  one release is always one catalog.

- **`MissingCatalogError` is the new structural I5 backstop.** A roster release
  absent from the map is an AUTHOR-time throw (the API/web assemble a complete
  map), evaluated eagerly while building the stamp. It replaces the three de-dupe
  guards: those refused a now-LEGAL state, so keeping them would be a _false_ I5
  (refusing valid input). The honest I5 surface narrows to "a referenced catalog
  isn't there", which is a genuine data error.

- **`SiteStamps.catalogVersion: number` becomes `catalogVersions:
Record<releaseId, number>`** — recorded from the catalog each release _actually
  used_ (`catalogFor(release).version`), never a claimed number.
  `verifyReproducibility` reads the distinct stamped versions, reloads each,
  rebuilds the releaseId→Catalog map, and re-derives. The deep-equal is
  key-order-safe exactly as the pre-existing `releaseIds` Record is.

- **Guards removed, not narrowed.** `mixed_catalog` (quote issue),
  `upgrade_catalog_conflict` + the `catalogConflict` helper (pin opt-in), and the
  web bundle's loud throw are deleted. `pinVersion` becomes a pure version move
  (no catalog pre-flight): pinning `model-A@2 (catalog@3)` beside `model-B@1
(catalog@2)` is fully supported. `assertAssigned` stays set-membership and
  re-derivation still bypasses it — **I3 ≠ visibility ≠ pin** is unchanged.

- **The `quote.catalog_version` denorm column is dropped.** A per-quote _map_ of
  versions has no single-column form and was never queried; the authoritative copy
  lives in `stamps.catalogVersions` (JSONB). `priceTableVersion` stays a scalar
  denorm (one price table per site). Migration is a metadata-only `DROP COLUMN`
  with `lock_timeout` (ADR 0038); no data loss (stamps hold it), and pre-users
  there is no N-1 window.

- **The web carries a `catalogs` map end to end.** `CatalogBundle.catalog` →
  `catalogs: ReadonlyMap<releaseId, Catalog>` (the RSC fetches each distinct
  version once and keys by `product.release.id`); `deriveForUi` and
  `SiteDeriveContext` take the map; the configurator/site clients resolve each
  product's catalog reactively. Empty bundle = empty map (the
  `catalogs.size === 0` guard).

## Consequences

- An org can run `fence-run` on `catalog@2` and a gate on `catalog@1` at once; the
  configurator and site canvas derive each against its own catalog, and a quote
  spanning both **issues and re-derives byte-identically** (proven by
  `per-release-catalog.itest.ts` — a mixed `catalog@1` + `catalog@2` quote;
  `stamps.catalogVersions` records both versions and verify reproduces).
- I3 holds: the single-catalog goldens still reproduce `129891.504` / `79039.86`
  (the numbers are price-driven; only the stamp _shape_ changed). The
  `upgrade_catalog_conflict` landmine is gone, so the ADR-0064 opt-in is now a
  clean version move.
- This completes ADR 0064's intent rather than reversing it: the pin/upgrade
  machinery (`org_model_pin`, `getUpgradeOffers`, `assertAssigned`) is untouched.
- **Deferred:** a vendor-initiated "offer this upgrade to all orgs on the prior
  version" fan-out (today the vendor assigns the newer version per org, then the
  tenant opts in) — this slice only removes the catalog constraint on
  _coexistence_; `pinVersion` becoming a pure move leaves that seam clean.

Governing code: `packages/engine/src/site.ts` (`deriveSite`, `catalogFor`,
`MissingCatalogError`, `SiteStamps`), `apps/api/src/modules/quotes/` (issue +
`verifyReproducibility`), `apps/api/src/modules/releases/` (`pinVersion`),
`apps/web/app/configurator/` + `apps/web/app/site/` (the `catalogs` bundle).
