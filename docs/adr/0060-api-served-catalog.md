# ADR 0060 — Api-served catalog: retire the `@repo/fixtures` web source

**Status:** Accepted (2026-06-16). Implemented. Retires the ⌛ interim
`@repo/fixtures` web runtime source flagged in [ADR 0051](0051-generated-configurator.md)
/ [ADR 0054](0054-project-site-persistence.md); reads the immutable stores from
[ADR 0053](0053-quote-lifecycle.md), the org scope from
[ADR 0055](0055-org-scope-activation.md), and the price-blind rule from
[ADR 0056](0056-rbac-roles.md). The admin publish **UI** is the sibling
[ADR 0061](0061-admin-publish-ui.md).

## Context

The backend catalog machinery has existed since ADR 0053: immutable global
`release` + `catalog_version` stores and per-org versioned `price_table`s, with
admin-gated `POST` publish (ADR 0056), the I2 `validateRelease` gate, I3
409-on-republish, and audit. But the **web** never read any of it — the
configurator and site canvas imported releases + catalog + price table straight
from `@repo/fixtures` at build time (`apps/web/app/configurator/products.ts`), a
transitional shim explicitly marked ⌛. `@repo/fixtures`'s own contract is
"test-only — never imported by app or runtime code"; the web violated it.

Three gaps blocked the swap:

- **No web fetch layer** for the existing `GET /v1/releases`, `/v1/catalog-versions`,
  `/v1/price-tables/active` endpoints, and the data was imported as synchronous
  module singletons (the client surfaces `import { products }`), so it could not
  simply become an async fetch.
- **No starting config.** The configurator opens on a valid `ConfigInput`; the
  engine cannot derive one from `{}` (design-intent parameters — dimensions,
  fill type, direction — deliberately have no defaults, and `fill_type_id` drives
  a required `OptionSet`, so an empty input throws `ConfigError`). Fixtures
  supplied the golden corpus configs; the api served nothing equivalent.
- **No data in the DB.** Retiring the fixtures import leaves the web blank unless
  the golden corpus is published into a real database.

## Decision

- **`initialInput` is publish metadata on the release row, not model contract.**
  A nullable `initial_input` JSONB column on `release` (mirroring how
  `catalogVersion` already lives on the row, _not_ in the immutable
  `ProductModelRelease` body — so `@repo/model` is untouched). It is supplied in
  `PublishReleaseInput`, returned on `ReleaseDetail`, and **gated at publish via
  `gateInput(release, initialInput)`** — the same I7 input gate the engine runs,
  so a broken starting config (unknown key / missing required param) is a 422,
  never a product the configurator can't render. It is _not_ part of the I3
  derivation stamp (it is a UI starting point, not a frozen truth).

- **The web reads the catalog from the api, server-side, prop-passed.** A new
  RSC-only `fetchCatalogBundle(client)` (`app/configurator/catalog-bundle.ts`)
  assembles the `CatalogBundle` = published releases (+ bodies + `initialInput`),
  the one shared catalog version they pin, and the org's active price table. The
  configurator + site RSCs fetch it with `createServerApiClient` (session
  forwarded) and prop-pass it; the engine still runs client-side (pure, I1). This
  follows the `projects` precedent (web-local fetch via `apiFetch` + validator
  `parse`), not a `@repo/api` factory. `products.ts` is reduced to the shared
  types + `buildProductIndex`; the canvas keeps its product-index addressing, the
  index **rebuilt from the api response** keyed by `releaseId` (order-independent
  — persistence already pins by `releaseId`).

- **Workshop is price-blind by absence, server-enforced.** `/v1/price-tables/active`
  403s a workshop session (ADR 0056). The bundle catches that (and a 404 = no
  active table) and yields `prices: null` — never a throw. The engine requires a
  price table, so a null-prices session renders a notice instead of the engine
  (the configurator does not run price-blind). This _corrects_ the prior fixtures
  behaviour, which shipped prices into every client's bundle and merely hid the
  money in the UI.

- **One shared catalog per slice.** Both published releases pin `catalogVersion 2`,
  so the bundle fetches one catalog and `deriveSite`'s single-catalog contract is
  untouched. Multiple distinct pinned versions would need a per-instance catalog
  (an engine change) — out of scope; the bundle assembles from the one distinct
  version the published set pins.

- **A standalone seed publishes the golden corpus.** `apps/api/src/seed.ts` boots
  a minimal Nest context (mirrors `worker.ts`) and calls the existing publish
  services — never raw inserts (so it runs `validateRelease`/`gateInput`, writes
  audit, stays `@Transactional()`). Order: catalog@1, catalog@2, sliding-gate@1
  - fence-run@1 (both pinned to catalog@2, with their golden `initialInput`), then
    a default price table (`sitePrices`/`siteCosts`) for **every org that lacks
    one** (price tables are per-org). Idempotent — `ConflictException` (409) is
    skipped. Wired as a `setup.mjs` step after migrations. `@repo/fixtures` becomes
    a **runtime dependency of `apps/api`** for this one dev-bootstrap consumer, and
    a **test-only devDependency of `apps/web`** (its proper role).

## Consequences

- The ⌛ `@repo/fixtures` web runtime source is gone: `products.ts` holds types
  only, `initial.ts` inlines the release-agnostic demo geometry and builds the
  "Load demo" roster from the api-served products' `initialInput`, and
  `@repo/fixtures` is dropped from `apps/web` dependencies + `transpilePackages`.
  It remains the **golden source for web tests** via a test-only
  `golden-bundle.ts` (the delta-0 locks — gate `81451.504`, site `129891.504` —
  are unchanged).
- A new tenant must have a price table to use the configurator/site; the seed
  backfills existing orgs. Auto-provisioning a default price table on org
  creation (so a brand-new signup is immediately functional) is **deferred** — a
  follow-up; the seed covers the dev/pre-users case.
- Per-tenant release **visibility/assignment** is still deferred (CORE_SPEC §3):
  all published releases are visible to every org (the interim).
- The OpenAPI contract snapshot gains `initialInput` on the release schemas.
- I3 is unaffected — `initialInput` lives outside the frozen body and is not a
  stamp input; quote reproducibility still re-derives byte-identically.
- Live seed run is deferred where the compose DB port is occupied by another
  project; the seed is compile- + logic-verified and idempotent, so it runs clean
  on a free stack via `pnpm run setup`.
