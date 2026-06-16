# ADR 0063 — New-org default provisioning (vendor-configured release assignment)

**Status:** Accepted (2026-06-16). Implemented. Deliberately reverses the
"new-org default release assignment off" deferral
[ADR 0062](0062-per-tenant-release-visibility.md) left open, so a fresh
self-signup tenant lands functional instead of empty — while keeping assignment
VENDOR-controlled per CORE_SPEC §3.

## Context

After [ADR 0055](0055-org-scope-activation.md) (auto-org per user) +
[ADR 0062](0062-per-tenant-release-visibility.md) (vendor-assigns visibility), a
brand-new self-signup org lands **empty**:

- No assigned releases → `GET /v1/releases` returns `[]` → an empty configurator
  palette (a fresh org starts with NO assignments; the vendor assigns
  explicitly).
- No price table → `resolveActive` 404s → quotes can't issue (price tables are
  per-org, [ADR 0055](0055-org-scope-activation.md)).

The seed (`apps/api/src/seed.ts`) already bootstraps this for _seeded_ orgs (it
assigns the golden corpus + publishes a default price table per org). Nothing did
it for an org created at runtime by a real signup. ADR 0062 explicitly deferred
"new-org default release assignment" — this ADR closes it.

CORE_SPEC §3: "Authoring is vendor-only … Tenants are ASSIGNED releases and pin
to them." So a default assignment must not become "every org silently gets every
published release" — that would drift from vendor-controlled visibility.

## Decision

- **Default RELEASE assignment, vendor-CONFIGURED.** A new env list
  `PLATFORM_DEFAULT_RELEASE_IDS` (comma-separated release ids, the
  `PLATFORM_ADMIN_EMAIL` precedent) names the starter set every genuinely-new org
  is auto-assigned at provision time. Empty/unset = no default (the ADR 0062
  behaviour). This keeps the SET a vendor decision (§3) while automating delivery
  — NOT "all currently-published" (which would leak every future release to every
  future org, a decision the vendor never makes).

- **NO default PRICE TABLE — "empty-but-honest".** A fabricator's prices are
  their own data; auto-provisioning a placeholder layer would ship fake numbers
  (and `@repo/fixtures` is dev-bootstrap-only, banned in runtime modules). A
  fresh org gets a populated palette but no prices until it publishes its own
  table; the configurator already degrades to a "publish a price table" notice
  ([ADR 0060](0060-api-served-catalog.md)). Quoting unlocks once the org publishes
  a table. (A vendor-shipped starter layer was considered and rejected:
  prefilled-demo vs empty-but-honest — honest won.)

- **Wiring without a module cycle.** The org is created in the Better Auth
  `session.create.before` hook (`auth.instance.ts`), and `AuthModule` is a leaf —
  it must never import `ReleasesModule` (which already imports `AuthModule`; the
  reverse edge is uncompilable). So a mutable **`OrgProvisioningHook` registry**
  lives in `AuthModule`: the AUTH factory passes its `run()` into `createAuth` as
  the `onOrgProvisioned` callback, and a new `OrgProvisioningModule` (imports
  Auth + Releases, owns no schema — the `PlatformModule` shape) registers its
  closure on init. `run()` reads the handler lazily, so init order is irrelevant
  (shared app-scoped singleton). Worker/seed/CLI never load the module → the hook
  stays unregistered → no-op.

- **Inside the genuine-new-owner branch only.** The call sits AFTER the
  invite-first early-return ([ADR 0058](0058-invite-first-onboarding.md)), so an
  invitee — who gets no personal org — is never provisioned a default-assigned
  workspace.

- **CLS + transactions.** The Better Auth handler is mounted raw on Fastify,
  OUTSIDE the Nest request pipeline, so no ambient CLS is active. Each
  `@Transactional()` `ReleasesService.assign` is wrapped in its own `cls.run()`
  (exactly like the seed's `withSkip`), and each is isolated in try/catch so one
  unpublished/retired id doesn't abort the rest. `assign` is idempotent (ON
  CONFLICT DO NOTHING), so a redundant call is a safe no-op.

- **Fail-soft.** Provisioning runs synchronously in the user's first session, so
  a failure must NEVER block login — `OrgProvisioningHook.run` is the fail-soft
  backstop: it logs and degrades to the empty-org state (recoverable via a seed
  re-run or a `/platform` assign), it does not fail the session.

- **Audit actor** = the synthetic `system-provision` (mirrors the seed's
  `system-seed`). Honest: the SYSTEM assigned per the vendor's config, the owner
  did not choose these releases; `org_release_assignment.assignedBy` is a soft
  text ref (no FK), so a synthetic id is safe.

## Consequences

- A fresh signup gets a populated catalog immediately (when the vendor has
  configured the default set); it still must publish a price table before
  quoting — the honest production behaviour.
- No schema/migration change: the slice only writes `org_release_assignment` rows
  through the existing `@Transactional()` service. Orgs created before this lands
  remain un-provisioned until a seed re-run (the idempotent seed loop fills them).
- Re-derivation is untouched (I3 ≠ visibility, ADR 0062): the default set governs
  discovery only.
- **Deferred:** a vendor-shipped starter price table (if "prefilled-demo
  onboarding" is later wanted); a `default` flag on the release row (vs the env
  list) once a publish-UI surface exists; release version-pin / opt-in-upgrade UX.

Governing modules: `apps/api/src/modules/provisioning/` +
`apps/api/src/modules/auth/org-provisioning-hook.ts`.
