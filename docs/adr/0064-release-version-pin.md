# ADR 0064 — Release version pin / opt-in upgrade

**Status:** Accepted (2026-06-18). Implemented. Closes the "version-pin / explicit
opt-in-upgrade UX" deferral [ADR 0062](0062-per-tenant-release-visibility.md) and
[ADR 0063](0063-new-org-default-provisioning.md) left open — the second half of
CORE_SPEC §3 ("tenants are assigned releases and pin to them; upgrades are
explicit opt-in per tenant").

## Context

[ADR 0062](0062-per-tenant-release-visibility.md) gave the vendor an
`org_release_assignment` join (which immutable releases an org may SEE) but only
the "assigned" half of §3. The "pin / opt-in" half was deferred, noting "multiple
versions of a model coexist if both are assigned". That coexistence is exactly the
gap: a release is identified by the natural key `"modelId@version"`, the row
carries `modelId` + `version` separately, but assignment is flat set-membership.
So once the vendor publishes and assigns `sliding-gate@2` next to `@1`, a tenant
**silently sees both** in the configurator picker — no indication which is current,
no opt-in moment. §3 forbids exactly that ("upgrades are **explicit** opt-in").

The hard constraint is I3 (eternal reproducibility): a quote stamps the exact
`"modelId@version"` and re-derives byte-identically forever via the GLOBAL,
unscoped `findByReleaseId`. Whatever "pin" we add must NOT be a re-derivation key —
it governs what a tenant configures with for NEW work, never what an issued quote
replays. (`verifyReproducibility` already bypasses assignment — I3 ≠ visibility;
the same asymmetry holds for the pin.)

## Decision

- **A pin is a first-class concept, separate from assignment.** New
  `org_model_pin(organizationId, modelId, pinnedReleaseId, pinnedBy)`,
  unique `(organizationId, modelId)` — one ACTIVE version per model per org.
  Assignment stays **availability** (disposable discovery); the pin is the
  **active version** the configurator offers for new work, and an auditable record
  of the tenant's deliberate choice (§7 ledger). Keeping them separate leaves the
  ADR-0062 assignment join untouched (lower blast radius, N-1-safe).

- **Lazy default, never silent move.** `ReleasesService.assign` creates the pin
  for a model the org has no pin for yet (the first assigned version is the active
  one — `ensurePin`, idempotent + self-healing). Assigning a NEWER version of an
  already-pinned model does **not** move the pin — it becomes an "upgrade
  available" offer. So new-org provisioning (ADR 0063) and the seed pin
  automatically, through the one `assign` path, with no extra wiring.

- **The configurator list is PINNED-only.** `GET /v1/releases` (`listForOrg` →
  `listPinnedAssignedTo`) now returns the org's pinned version per model
  (assigned ∧ pinned), so the picker shows one version per product. This both
  implements §3 and SHRINKS the mixed-catalog blast radius: an available-but-not-
  opted-in `@2` on a new catalog can't break the bundle, because it isn't in it
  until opt-in. (Pre-existing assignments are backfilled to their highest assigned
  version in the migration, so the configurator keeps offering what it did before.)

- **Opt-in is tenant-controlled, admin-gated.** `POST /v1/releases/pin {releaseId}`
  moves the pin for that release's model. Admin-only (`@RequireRole("admin")`, a
  catalog-config decision like price tables; the server is the authority, the
  `/admin` "Product versions" surface mirrors the role). The target must be
  PUBLISHED and ASSIGNED — you can only pin a version the vendor made available
  (preserves ADR 0062 vendor-push gating; publish alone does nothing). `GET
/v1/releases/upgrades` lists the per-model offers that power the surface.

- **`assertAssigned` stays set-membership, NOT pin-aware.** A quote roster on any
  ASSIGNED release issues, even a non-pinned one — the pin governs the default
  offer, not authorization. So a tenant mid-upgrade can still re-quote old project
  instances on the prior (still-assigned) version. (`verifyReproducibility` still
  bypasses the check entirely — I3.)

- **Opt-in pre-flight: one catalog (I5).** The engine derives a site against ONE
  catalog version (the `mixed_catalog` guard, and the web bundle's loud throw).
  An opt-in whose post-move pinned set would span >1 catalog version is refused
  LOUD — 422 `upgrade_catalog_conflict` — rather than silently breaking the
  configurator. (The real fix for cross-catalog products is the deferred
  per-release-catalog slice; this guard is the honest interim. `catalogConflict` is
  a pure, unit-tested helper.)

- **Pin hygiene.** `unassign` drops any pin pointing at the unassigned release (a
  pin must never reference an unassigned release); a still-assigned OTHER version
  of the model is NOT auto-promoted (no silent version change).

## Consequences

- A tenant on `sliding-gate@1` sees the vendor's `@2` as an explicit "Upgrade to
  v2" in `/admin`; opting in moves the pin so new work uses `@2`. **Old quotes and
  saved project instances stay on `@1`** — `project_instance.releaseId` and quote
  stamps are the exact version, untouched. Only new work uses the pinned version.
- I3 is completely untouched: a quote issued on `@1` reproduces `129891.504`
  forever after the org opts into `@2` (proven by `release-version-pin.itest.ts`).
- Vendor console (`/platform`) groups releases by model family and badges each
  org's active pin (the `pins` field added to `ReleaseAssignments`).
- Schema is expand-only (new table + a `release(model_id, version)` index +
  backfill); N-1-safe (old code ignores the pin table).
- **Deferred:** per-release catalog (so different models can pin different catalog
  versions — the real fix behind the opt-in `upgrade_catalog_conflict` guard); a
  vendor-initiated "offer this upgrade to all orgs on the prior version" fan-out
  (today the vendor assigns `@2` per org, then the tenant opts in).

Governing module: `apps/api/src/modules/releases/`. Schema:
`packages/db/src/schema/releases/index.ts` (`org_model_pin`).
