# ADR 0058 — Invite-first onboarding (suppress personal-org provisioning for invitees)

**Status:** Accepted (2026-06-15). Implemented. Resolves the deferred wart in
[ADR 0057](0057-org-invite-member-sharing.md); builds on the session-hook
provisioning of [ADR 0055](0055-org-scope-activation.md).

## Context

ADR 0055 made the org scope live with ONE self-healing hook: on a user's first
session, `session.create.before` (in `auth.instance.ts`) auto-provisions a
personal org + `owner` membership, then stamps `activeOrganizationId`. ADR 0057
added the invite/accept lifecycle and made the active-org default deterministic
(prefer the `owner` membership).

ADR 0057 documented the cost of those two choices interacting: **every** user —
including someone who only ever joins an employer's org via invite — got a
personal org. A pure invitee therefore ended up in two orgs (their dead personal
workspace + the inviting org) and, because the login default prefers the `owner`
org, landed in the dead workspace on **every** login, forced to switch each
session. ADR 0057 named the fix path: "invite-first onboarding that suppresses
personal-org provisioning for invitees, OR persisting last-active org." This ADR
takes the first option.

Key facts that make invite-first the clean, surgical fix (verified against
better-auth 1.6.16 source):

- The `invitation` row is created with `status='pending'`, keyed by the invitee's
  **email**, before the invitee has an account — so it is queryable at the
  invitee's signup.
- `acceptInvitation` **unconditionally** calls `setActiveOrganization` on the
  current session, so the invitee is correctly scoped to the invited org for the
  session in which they accept; the wart only ever bit on the _next_ login.
- The session hook already queries the `member` model via `ctx.context.adapter`;
  the same adapter reads the `invitation` model with no new wiring or schema.

## Decision

- **Suppress personal-org provisioning when a pending invite exists.** In
  `session.create.before`, after finding no membership for the user (the
  first-session branch), query the `invitation` model by
  `(email = user.email.lower(), status = 'pending')` and keep only **unexpired**
  rows (`expiresAt > now` — Better Auth does not eagerly expire). If any remain,
  return without provisioning and without stamping an active org. The user gets
  **no personal org**; their session is org-less until they accept.

- **An org-less session is the correct, fail-closed transient state.** Scoped
  `/v1/*` endpoints 403 (`@CurrentScope` / `RolesGuard`, ADR 0055) while the
  invitee has no org — which is exactly right, they have no tenant yet. The
  `/accept-invitation/:id` page is a Better Auth route (`/api/auth/*`), not a
  scoped `/v1/*` route, so it works org-less. On accept, `acceptInvitation`
  stamps the invited org on the session; on every later login the hook's
  `any membership` fallback re-stamps it — no dead workspace, ever.

- **No schema change.** Invite-first is pure hook logic over the existing
  `invitation` table. The alternative (sticky last-active org) would need a
  `user.lastActiveOrganizationId` column plus switch-persistence — deferred (see
  below); it solves a _different_, rarer problem.

- **Complete the `?next=` round-trip on login (web).** The accept page already
  bounces a signed-out visitor to `/login?next=/accept-invitation/:id`, but the
  login form silently dropped `?next=` and always landed on `/account` — which,
  post-suppression, would 403 for a not-yet-accepted invitee. The login page now
  reads `?next=`, validates it as a **same-origin relative path**, and the form
  redirects there. The validator resolves `next` with the WHATWG URL parser
  against a dummy origin and rejects anything off-origin — covering absolute
  URLs, `//host` / `/\host`, AND the control-char variants (`/%09//evil.com` →
  tab-stripped by the parser to `//evil.com`) a naive `startsWith` check lets
  through. Closes the open-redirect class. This makes the invite link → sign in
  → accept → `/team` flow whole.

- **Refresh the session cookie after accept (web).** `acceptInvitation` stamps
  the active org on the session ROW but does NOT re-issue the signed
  `session_data` cookie; with `cookieCache` on, a same-session read keeps serving
  the stale cookie for up to its `maxAge`. For an invite-first invitee that stale
  cookie is **org-less**, so the post-accept `/team` (which prefetches `/v1/me`)
  would 403 for minutes. The accept handler now forces a cache-bypassing
  `getSession({ disableCookieCache: true })` after accept, which re-reads the DB
  session (the invited org) and re-stamps the cookie — so the very next request
  is correctly scoped. (This also fixes the pre-existing wrong-active-org
  staleness window for normal post-signup invitees.)

## Consequences

- A user invited before they sign up never carries a dead personal org and lands
  directly in the inviting org on every login. The documented ADR 0057 wart is
  closed for the dominant onboarding flow (an employer inviting employees who do
  not already have accounts).

- **Unchanged by design:** a user who signs up first and is invited _later_ keeps
  their own org and is a genuine multi-org member; the deterministic `owner`
  preference still lands them in their home org (ADR 0057). That is intended, not
  the wart.

- **Known limitation — pre-emptive-invite griefing (minor, adversarial).**
  Suppression is inherent to invite-first: if _anyone_ invites an email before
  that person signs up, their first session is org-less until they accept or the
  invite (48h) expires. For the intended flow (employer invites employee) that is
  exactly right. The adversarial case — an existing org owner/admin pre-invites a
  victim's email to a junk org — leaves the victim temporarily org-less with only
  an "Accept" button (no "Decline" in the UI yet), recoverable today only via the
  `reject-invitation` API + re-login, or by waiting out the 48h. Severity is low
  (attacker must be an existing org member, must know the email, must beat the
  victim's signup; impact is a ≤48h temporary block, self-healing), and pre-users
  it affects nobody. The proper fix (a Decline button that rejects + re-provisions
  cleanly) rides with the invitee-UX/self-registration work below; deferred, not
  built here.

- **Deferred (not this slice):**
  - **Sticky last-active org** — persist a switcher choice across sessions for
    genuine multi-org users (own org _and_ invited). Needs a user column + a
    persistence hook on `setActive`. The remaining half of ADR 0057's named fix.
  - **Web self-registration + Decline** — there is no Better Auth sign-up UI today
    (only a login page; the homepage "create user" form is the skeleton demo
    CRUD). A brand-new invitee with no account cannot self-onboard through the web
    until a register surface exists, and the accept page has no Decline action. Out
    of scope here; the `?next=` + cookie-refresh fixes already serve an
    existing-account invitee through accept → `/team`.

- Proof: `apps/api/test/org-invite.itest.ts` adds the invite-first case — admin
  invites an email, the invitee then signs up at that email and has **zero**
  memberships (org-less session 403s `/v1/me`), accepts to exactly **one**
  membership in the inviting org as `sales`, and a fresh login resolves `/v1/me`
  to `sales` there. The existing "invited-after-signup" case stays green
  (invitee signs up first → still provisioned → lands in their own org).
