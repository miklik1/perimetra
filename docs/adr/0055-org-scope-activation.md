# ADR 0055 — Org-scope activation (supersedes the dormant ADR 0041 stance)

**Status:** Accepted (2026-06-13). Implemented. Activates the tenancy seam ADR
0041 deliberately left dormant.

## Context

ADR 0041 built a tenancy **seam** but kept multi-tenancy dormant: per-tenant
repositories scoped on `ownerId = scope.userId`, `organizationId` was a
populated-but-never-filtered column, sessions carried no active org, and
`org:<id>` realtime channels failed closed. The seam's whole point was to make
activation a one-expression-per-module change rather than a codebase-wide hunt.
Step 6 needs a real tenant boundary: roles (admin/sales/workshop), the admin
publish gate, and per-tenant data isolation all sit on an org scope. Perimetra's
tenant is one fabricator company.

## Decision

- **Org provisioning — auto, one per user, no switcher.** Better Auth
  `databaseHooks` in `auth.instance.ts`: `user.create.after` creates exactly one
  `organization` + an `owner` `member` per new user; `session.create.before`
  stamps every session's `activeOrganizationId` from that membership. Self-serve
  org creation stays OFF (`allowUserToCreateOrganization: false`) — provisioning
  is the only path until a multi-org/invite slice. No web org UI this slice.
- **Org is the required scope.** `RequestScope.organizationId` is now non-null
  (`string`, was `string | null`); `scopeFromSession` throws
  `MissingOrganizationScopeError` on an org-less session and `@CurrentScope()`
  translates that to a 403 — the seam is fail-closed (playbook step 4).
- **One expression per module.** `projects`/`quotes`/`price-tables`
  `scoped()` flipped from `ownerId = scope.userId` to
  `organizationId = scope.organizationId`. `ownerId` is retained on every row as
  the creator/audit ref (stamped on insert), no longer the access boundary.
  Global vendor data (`release`, `catalog_version`) stays unscoped.
- **Schema.** `organization_id` → `NOT NULL` on the three tables; hot-path
  indexes re-keyed owner→org (`*_org_id_id_idx`); `price_table` version
  uniqueness is now **per org** (`price_table_org_version_uq`). The immutable I3
  stores (`quote`, `price_table`) get `owner_id` **and** `organization_id`
  `ON DELETE RESTRICT` — a frozen commercial artifact must survive user/tenant
  deletion. `project` (mutable user content) stays `CASCADE`.
- **Migration.** Expand→backfill→contract in one file (pre-launch, no traffic):
  synthesize one org + owner membership for every existing owner (deterministic
  ids, idempotent `ON CONFLICT`), stamp `organization_id`, then `SET NOT NULL` +
  FK/index changes. Zero-row on a fresh DB.
- **Realtime.** `org:<id>` unlocked for the session's active org only
  (membership = the stamped active org); any other org or an org-less session is
  still denied.

## Consequences

- **GDPR (ADR 0040) reconciled for free.** Erasure already _anonymizes_ the user
  row (never hard-deletes it) and deletes sessions/accounts; quotes/price-tables
  have no erasure handler. So `owner_id RESTRICT` is never violated — the I3
  records are retained under legal-retention while their author goes PII-free.
  No user-hard-delete path exists (`deleteUser` off; org member-removal cascades
  only `member`).
- **Same-org multi-member sharing is reachable but untested end-to-end** — the
  product has no invite flow yet, so today every user is the sole member of their
  own org. The org-keyed filter is unit-tested (`projects.repository.test.ts`
  asserts `organization_id` in the WHERE) and the cross-org 404 oracle is an
  integration test; full member-sharing lands with the invite slice.
- **Roles still pending.** This slice is the scope only; admin/sales/workshop +
  price-blind DTOs + margin-floor guard + admin publish gate build on it next.
- Reproducibility (golden `129891.504`) is unaffected — org scope gates access,
  not derivation.
