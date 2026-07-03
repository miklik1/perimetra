# ADR 0070 — Mandatory TOTP MFA for the platform operator

**Status:** Accepted (2026-06-23). Implemented; gate green (api 160, integration
109), adversarially reviewed. Closes the §1 gap-analysis item "MFA off on the
most dangerous credential" (Phase 0; the password-policy + audited-admin half
shipped in 0.4 under ADR 0040).

## Context

The platform/vendor operator (Better Auth `user.role==='admin'`, ADR 0062)
publishes **immutable releases to every tenant** and assigns/broadcasts them
cross-org. That credential was **password-only** — a phished password reached the
most dangerous surface in the system. Better Auth ships a `twoFactor` plugin but
it was dormant (not registered, no schema, no client).

## Decision

Register the Better Auth `twoFactor` plugin (TOTP) and make it **mandatory for
the platform operator**, enforced at the existing choke point:

- **Schema** (additive, N-1-safe migration, `lock_timeout`): a `twoFactor` table
  (`secret` / `backupCodes` / `userId` / `verified`) + a `user.twoFactorEnabled`
  boolean (default false). Export key + field keys are adapter-load-bearing
  (mirror the plugin's `schema.mjs` exactly); SQL table name = the BA model name
  verbatim (`twoFactor`), columns snake_case — the repo convention. No index on
  `secret` (the adapter only looks the row up by `userId`).
- **Enforcement** in `PlatformGuard`: a single fresh-per-request read
  (`MembershipService.loadPlatformAccess` → `{ role, twoFactorEnabled }`) gates
  the cross-tenant surface on BOTH `role==='admin'` AND `twoFactorEnabled`. A
  missing second factor 403s a **distinct `mfa_required` code** (vs `forbidden`)
  so the web can route the operator to enrollment rather than a dead end. The
  guard checks the user-level flag, not a per-session "2FA-verified" marker — the
  threat is a phished password reaching the surface, and a 2FA-enrolled user is
  challenged at every NEW sign-in. (A stricter per-session step-up is a possible
  Phase-D hardening.)
- **Enrollment / challenge** (web): `twoFactorClient` wired; the login form routes
  the `data.twoFactorRedirect` signal to a `/two-factor` TOTP-challenge page;
  `/account/security` does enable (password → secret + backup codes → confirm
  code) and disable. `skipVerificationOnEnable` stays OFF — the flag only flips
  after a live code is confirmed.
- **GDPR erasure** purges the credential: erasure **anonymizes** the user row
  (keeps the PK for I3 durability), so the `twoFactor` FK CASCADE never fires —
  the privacy processor deletes the `twoFactor` row explicitly and clears
  `twoFactorEnabled`, alongside `account`/`session`.

## Consequences

- The seeded dev operator (`PLATFORM_ADMIN_EMAIL`) starts `twoFactorEnabled=false`
  and must enroll via `/account/security` before the `/platform` console works —
  the correct secure posture. The seed is NOT auto-enrolled (a flag without a
  secret would be a login lockout). Seed-time publishing bypasses the guard
  (`SYSTEM_SCOPE`), so seeding is unaffected.
- Test seam: `promotePlatformAdmin` sets role + `twoFactorEnabled` (a usable
  operator); a role-only `grantAdminRole` exists for the admin()-plugin audit
  test, which re-signs-in and must not hit the challenge.
- Known follow-up (Phase A UX): `/v1/me` still reports `isPlatformAdmin` on role
  alone, so an un-enrolled operator is shown the `/platform` nav link (→ 403);
  route them to enrollment instead.

Supersedes nothing. Related: ADR 0040 (audit/GDPR plumbing), ADR 0062 (platform
operator role), CORE_SPEC §1.

## Amendment (2026-07-03, CAR-19): close the admin()-plugin raw-mount bypass

`PlatformGuard` only runs on Nest's `/v1/platform/*` routes. The Better Auth
`admin()` plugin's own six mutating endpoints (`impersonate-user`, `ban-user`,
`unban-user`, `remove-user`, `set-role`, `set-user-password`) mount on the raw
Fastify handler OUTSIDE Nest (same reason the ADR 0040 audit trail needed a
Better Auth hook, not a Nest interceptor) — so an operator without enrolled
TOTP could reach them directly, bypassing the mandatory-MFA gate entirely.
Closed with a `hooks.before` sibling to the existing `hooks.after` audit hook
in `auth.instance.ts`: a cheap `ctx.path` lookup against the SAME
`ADMIN_AUDIT_ACTIONS` map, then the SAME fresh-DB `{ isOperator,
twoFactorEnabled }` read `PlatformGuard` uses (`MembershipService.
loadPlatformAccess`, injected as `loadPlatformAccess` in `auth.module.ts` —
one source of truth). Because the admin() plugin resolves its own session only
_inside_ the endpoint handler (after `before` hooks run), the gate resolves it
itself via Better Auth's `getSessionFromCtx` (reads cookies/headers off `ctx`
directly, and caches the result on `ctx.context.session` so the plugin's own
subsequent lookup is free). A non-operator session falls through unchanged —
the plugin's own `hasPermission` check still governs that case; only an
MFA-less platform operator gets the distinct `mfa_required` 403, matching
`PlatformGuard`'s shape. Covered by `apps/api/test/auth.itest.ts` (403 without
TOTP, 200 once `twoFactorEnabled` is set, and an unchanged 403 for a
non-admin caller).
