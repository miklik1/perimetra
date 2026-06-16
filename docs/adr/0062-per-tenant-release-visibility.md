# ADR 0062 — Per-tenant release visibility (vendor-assigns via a platform actor)

**Status:** Accepted (2026-06-16). Implemented. Closes the interim leak that
[ADR 0060](0060-api-served-catalog.md) left open — "all published releases are
visible to every org" — by giving releases the per-tenant assignment
CORE_SPEC §3 requires, and introduces the platform/vendor actor that §3's
"authoring is vendor-only" implies. Retiers the publish gate of
[ADR 0056](0056-rbac-roles.md) from org-admin to vendor.

## Context

`CORE_SPEC` §3: "Authoring is vendor-only, permanently. Tenants are assigned
releases and pin to them; upgrades are explicit opt-in per tenant." Two gaps
remained after ADR 0053/0060/0061:

1. The `release`/`catalog_version` stores are GLOBAL and unscoped, and
   `GET /v1/releases` returned every published release to every org — no
   per-tenant visibility. Commercially wrong: fabricator A could see fabricator
   B's product line.
2. There was no vendor actor. `admin` was purely an org `member.role`, and the
   ADR 0056 publish gate (`@RequireRole('admin')`) let _any_ org admin publish a
   GLOBAL release visible to all orgs — "authoring is vendor-only" was not
   enforced.

The §3 wording reads two ways ("assigned" = vendor-push; "opt-in" = tenant-pull).
The commercially-correct reading for a vertical CPQ — the vendor (us) controls
which products each tenant may access — was chosen: **vendor assigns**.

## Decision

- **Platform/vendor actor.** Wire Better Auth's already-present admin() plugin
  field `user.role==='admin'` as the platform operator, via a `PlatformGuard`
  (`modules/auth`) that resolves it FRESH from the DB per request through
  `MembershipService.isPlatformOperator` — never the cached `session.user.role`
  (the 5-min cookie cache would make a grant/revoke stale), the same freshness
  contract as `RolesGuard`. `/v1/me` gains `isPlatformAdmin` (computed fresh).
  The operator is named per deployment by `PLATFORM_ADMIN_EMAIL` (the seed
  promotes them); orthogonal to the org `member.role`.

- **Authoring is vendor-only.** `POST /v1/releases` and `POST /v1/catalog-versions`
  move from the org `@RequireRole('admin')` (ADR 0056) to `PlatformGuard`. No org
  role grants publish anymore — an org admin gets 403, same as sales/workshop.
  Price-table publish STAYS org-admin (it is per-tenant data, not vendor authoring).

- **Assignment join.** A new `org_release_assignment(organizationId, releaseId,
assignedBy)` table, owned by the releases module (`schema/releases`),
  unique `(org, releaseId)`. `releaseId` is the natural key as a SOFT reference
  (no FK): the release store is append-only (the key never vanishes), the assign
  service validates existence+published on write, and assignments are DISPOSABLE
  discovery metadata — `organizationId` CASCADEs (unlike the I3 stores' RESTRICT).

- **Tenant visibility filter.** `GET /v1/releases` becomes tenant-scoped
  (`listForOrg` → `listAssignedTo`, an inner join to the assignment table — the
  analogue of `scoped()` for this otherwise-global store); an org sees ONLY its
  assigned releases. `GET /v1/releases/:id` is likewise tenant-scoped: an
  unassigned id 404s (indistinguishable from missing — no body leak, no existence
  oracle). The api-served bundle (`fetchCatalogBundle`) picks this up with no
  client change (the session cookie is already forwarded).

- **I3 ≠ visibility (the load-bearing asymmetry).** The GLOBAL `findByReleaseId`
  (quote re-derivation) stays UNSCOPED. Visibility gates DISCOVERY only — a quote
  stamped on a since-unassigned release re-derives byte-identically forever (the
  golden `129891.504`). The release-visibility itest proves it: unassign, then
  `verify` still reproduces.

- **Quote-issue defense-in-depth.** `quotes.issue` calls
  `releases.assertAssigned(scope, releaseIds)` AFTER resolving the releases (so an
  unpublished release still 400s before the 403), closing the direct-API seam the
  configurator's assigned-only palette opens. `verifyReproducibility` deliberately
  does NOT check (I3).

- **Vendor console.** `PlatformController` (`/v1/platform/*`, platform-only):
  global release list (the assignment picker), tenant org list
  (`OrganizationsService.listAll`, the only cross-tenant org read), and
  get/assign/unassign per org. Web `/platform` (gated on `isPlatformAdmin`) hosts
  publish (moved off `/admin`) + an assignment manager; `/admin` keeps the org's
  price tables. New `@repo/validators/platform` contracts.

- **Seed + new-org policy.** The seed promotes `PLATFORM_ADMIN_EMAIL` and ASSIGNS
  the golden corpus to every seeded org so dev keeps working. A NEW org starts
  with ZERO assignments — the vendor assigns explicitly (commercially correct; §3
  "assigned"). The empty-palette state degrades to a notice, not a crash.

## Consequences

- An org sees and can quote only its assigned releases; publishing is the
  vendor's alone. The §3 contract is honoured end to end.
- Integration proof (`release-visibility.itest.ts`): vendor-publishes /
  org-admin-403; tenant sees only assigned (org-scoped, no leak); `/:id` 404s
  unassigned; issue gated by assignment; **unassign → existing quote still
  reproduces** (I3 ≠ visibility). The roles itest matrix dropped publish (no
  longer an org-role power); a `seedGoldenCorpusFor` helper seeds+assigns the
  corpus via a throwaway operator across the affected itests.
- The web `/platform` console ships clean-but-locally-unverified (this box's DB
  ports are held by another project; covered statically by type-check/lint/build
  and behaviourally by the api itests). A vendor surface co-located on `/admin`
  was considered; a separate `/platform` route keeps a tenant admin's page free
  of vendor controls.
- `user.role='admin'` doubles as Better Auth's super-admin (ban/impersonate) — for
  this product the vendor operator IS the super-admin; acceptable and documented.
- Deferred: version PINNING / explicit opt-in-upgrade UX (today the vendor
  assigns specific immutable `releaseId`s; multiple versions of a model coexist if
  both are assigned — the §3 "pin/opt-in" mechanics are additive once a model has
  a v2); new-org default auto-assignment (deliberately off); a release detail
  endpoint for the platform console (it needs only summaries today).

## Sources

- CORE_SPEC §3 (Layer B — Product Model Release), §7 (Tenancy & roles).
- Supersedes the publish gate of [ADR 0056](0056-rbac-roles.md); builds on
  [ADR 0055](0055-org-scope-activation.md) scope and
  [ADR 0060](0060-api-served-catalog.md) api-served catalog.
