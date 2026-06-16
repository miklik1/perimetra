# provisioning — new-org default bootstrap (ADR 0063)

Orchestration-only module (no schema, no controller, no repository). When the
Better Auth `session.create.before` hook auto-provisions an org for a genuinely-
new owner (ADR 0055), this module assigns the **vendor-configured default
release set** (`PLATFORM_DEFAULT_RELEASE_IDS`) so a fresh tenant lands with a
populated catalog instead of an empty palette. The runtime analogue of the
seed's per-org loop.

No default **price table** is provisioned — a fabricator's prices are their own
data ("empty-but-honest", ADR 0063); the configurator degrades to a notice until
the org publishes one.

## Public surface

- `OrgProvisioningService.provisionDefaults(orgId, ownerUserId)` — the runtime
  bootstrap. Fail-soft + idempotent + per-release isolated.
- `OrgProvisioningModule` — registers the closure into the AuthModule-owned
  `OrgProvisioningHook` on init.

## Must never

- Be imported BY AuthModule (or any leaf): auth must stay cycle-free. This
  module depends on Auth + Releases, never the reverse — the bridge is the
  mutable `OrgProvisioningHook` registry that lives in AuthModule.
- Reach into another module's schema/repository — cross-module writes go through
  `ReleasesService.assign` (the owning service), never a join (ADR 0032).
- Block session creation: `provisionDefaults` runs inside the auth hook, so a
  failure must degrade to the empty-org state, never fail the user's login
  (`OrgProvisioningHook.run` is the fail-soft backstop).

Governing ADR: `docs/adr/0063-new-org-default-provisioning.md`.
