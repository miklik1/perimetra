# ADR 0041 — Tenancy seam: scoped repositories, dormant organization data model

**Status:** Accepted (2026-06-11). Seam implemented; multi-tenancy itself
deliberately NOT built.

## Context

Most B2B client projects eventually need organizations/workspaces, and
retrofitting `organization_id` across every table, query, cache key, and
channel is the most expensive retrofit in B2B software. The v1 spec called
this out of scope; the deep-analysis review reversed that to "seam now,
feature later" — hours now versus weeks per project later.

## Decision

- **Data model dormant but present:** Better Auth `organization()` plugin
  tables exist (organization/member/invitation, migrations applied); the
  feature is off (`allowUserToCreateOrganization: false`). The reference
  `project` table carries a nullable `organizationId` FK from day one.
- **One scoping seam:** `RequestScope { userId, organizationId | null }`
  resolved from the session (`@CurrentScope()`), and the repository pattern
  routes EVERY query through a single private `scoped()` filter expression —
  ownership (`ownerId = scope.userId`) today, org membership tomorrow.
  Probe-proven: user B sees neither user A's list items nor A's project by id
  (identical 404 for missing vs foreign — no existence oracle).
- **Fail-closed everywhere the seam surfaces:** `org:<id>` realtime channels
  are DENIED until membership checks exist (ADR 0035); storage keys and
  audit rows already carry entity scoping.
- **The retrofit playbook lives in code** (`common/tenancy/request-scope.ts`
  doc comment): enable the plugin → backfill `organizationId` → switch each
  repository's `scoped()` from owner to membership → enable org channels.
  Five steps, each mechanical, because every query already flows through the
  seam.

## Consequences

- Single-tenant projects pay one nullable column and one indirection.
- Multi-tenant projects change ONE expression per repository instead of
  auditing every query in the codebase.
- `user.locale` rode along as the first Better Auth `additionalFields` use
  (locale-aware email per ADR 0035 now uses the real per-user value).
