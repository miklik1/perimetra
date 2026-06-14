# ADR 0057 — Org invite + member sharing (Better-Auth-owned lifecycle, custom roles)

**Status:** Accepted (2026-06-15). Implemented. Builds on ADR 0055 (live org
scope) and ADR 0056 (membership-scoped RBAC), making multi-member orgs reachable
through the UI for the first time.

## Context

After ADR 0055/0056 the org boundary and the role guard were live, but every
user was the **sole member of their own auto-provisioned org**: a multi-role org
was only reachable by writing `member.role` directly in the DB. The roles slice
explicitly deferred the invite + role-management UX. This slice closes that gap —
a fabricator admin invites colleagues (sales/workshop), they accept, and the
RBAC matrix that already existed finally has more than one body to apply to.

Better Auth's organization plugin (already mounted, ADR 0055) **owns the
invitation lifecycle end-to-end** — the `invitation` table, token, expiry, and
the invite/accept/cancel/member-management endpoints (mounted at
`/api/auth/organization/*`, outside Nest). The auth module's CONTEXT rule is
"don't hand-roll what Better Auth owns." The only gaps blocking invites were
configuration: the plugin ran with default roles (`owner`/`admin`/`member`) so it
could not invite as `sales`/`workshop`, and the client wrapper loaded no
`organizationClient`, so the FE had no invite methods.

## Decision

- **Lean on the Better Auth org plugin; do not hand-roll.** Invite, accept,
  cancel, list, member-role-update, member-remove, and active-org switching are
  all the plugin's endpoints, driven from the FE via `organizationClient`. There
  is **no `/v1/*` module** for invites — that would duplicate the token/expiry/
  accept machinery Better Auth already owns.

- **Custom access-control roles bridge to our `OrgRole`.** A `createAccessControl`
  over the plugin's default statements defines `owner`/`admin` (Better Auth's full
  member/invitation statement sets) and `sales`/`workshop` (the **empty** set —
  read-only, never invite/cancel/mutate a membership). These roles ARE the
  authorization for the invite + member-management endpoints (our `RolesGuard`
  never sees them — they mount outside Nest). They are **distinct from, but kept
  aligned with**, the app-route RBAC (`OrgRole`/`RolesGuard`, ADR 0056) that gates
  `/v1/*`; the `member.role` string is the join — Better Auth writes it on
  invite/accept, `mapMemberRole` reads it.

- **The role matrix is DELIBERATELY DUPLICATED, not shared across packages.** The
  server copy is `apps/api/src/modules/auth/org-access.ts` (passed to
  `organization({ ac, roles })`); the client copy is
  `packages/auth/src/permissions.ts` (passed to `organizationClient({ ac, roles })`).
  This follows the codebase's existing precedent for the role _tuple_
  (`common/rbac/org-role.ts` ↔ `@repo/validators` `ORG_ROLES`, "change them
  together"): the api consumes workspace packages as built `dist`, but `@repo/auth`
  is a source-only React package, so importing it into the backend would force a
  build-coupling change for ten lines of config. Server and client are separate
  runtimes — these `ac`/role objects were always going to be distinct instances.

- **Invitation email routes through the email module.** The plugin's
  `sendInvitationEmail` callback renders a locale-aware react-email template via
  `EmailService` (cs default; the invitee may have no account yet, so no
  `user.locale` — falls back to the default locale). Link target:
  `${WEB_ORIGIN}/accept-invitation/:id`. Expiry 48h.

- **Active-org default is now DETERMINISTIC.** The ADR 0055 session hook stamped
  an _arbitrary_ membership; once a user belongs to two orgs (anyone who accepts
  an invite) that was a coin-flip per login. The hook now prefers the user's
  **owner** membership (their home org), falling back to any membership, then to
  fresh provisioning. An explicit `setActive` (the switcher) overrides it for the
  rest of the session.

- **Web surface:** a Team page (`/team`) — member roster with role badges,
  admin-only invite form + pending-invitation management + per-member role change/
  remove, all gated by the authoritative `/me` role mirror; an org switcher
  (hidden for single-org users) that clears the query cache on switch so every
  scoped query re-reads under the new tenant; and an accept-invitation landing
  (`/accept-invitation/:id`) behind `AuthGuard`.

## Consequences

- Multi-member, multi-role orgs are reachable through the product. The ADR 0056
  guard/DTO/matrix now apply to real invited members; the deferred role-management
  UX is delivered.
- **Known limitation (documented, deferred):** auto-provisioning still gives every
  user their own personal org (ADR 0055). An invited employee therefore carries a
  dead personal workspace and, because the login default is their _owner_ org,
  lands there on each login — they must switch to the company org per session.
  Pre-users this affects nobody. The fix path (invite-first onboarding that
  suppresses personal-org provisioning for invitees, OR persisting last-active
  org) is a follow-up, not this slice.
- Self-serve org creation stays OFF; provisioning remains the only org-create path.
- Proof: `apps/api/test/org-invite.itest.ts` — admin invites (persisted
  pending/role), a workshop member is denied by the ac gate (not RolesGuard), an
  invitee accepts and becomes a member of the inviting org while keeping their own,
  and a fresh login deterministically resolves `/me` to their home-org role.
