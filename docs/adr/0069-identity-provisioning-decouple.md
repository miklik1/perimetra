# ADR 0069 — Decouple org provisioning from the email+password credential

**Status:** **Accepted** (2026-07-16) — proposed 2026-06-22, ruled Accepted under
the HQ 2026-07-16 unblock delegation (vault `Decision — 2026-07-16 unblock rulings
(Martin's trust delegation)`, ruling 7; realizes CAR-37). This ADR records the
decision to cut a seam BEFORE it becomes expensive; **no code changes ship with
it** — acceptance ratifies the direction, the implementation stays demand-pulled
(Phase D). It is the "decide the provisioning model now" item from the enterprise-
readiness gap analysis (vault `Decision — enterprise-readiness gap analysis &
phased roadmap`), Phase 0.

**Federation alignment (why now, 2026-07-16):** the credential-agnostic
`provisionWorkspace` seam this ADR defines is exactly the shape the fleet's Wave-0
identity direction now requires — "pure Sign-in-with-Cardo" (G2a) and the landed
`@cardo/federation-kit` both assume provisioning is triggered by "a principal
exists", not "a principal authenticated with a Perimetra password". Leaving the
seam Proposed past the D2 federation window would invite exactly the coupling
(provisioning welded to the password flow) that a later Sign-in-with-Cardo / SSO
integration would then have to unwind as a tenant migration. Accepting now fixes
the direction while the SSO/SCIM build itself stays demand-pulled. Reversible: the
veto is to flip back — no build rides on it today.

## Context

Org provisioning is currently **welded to the email+password signup flow**. Per
[ADR 0055](0055-org-scope-activation.md) the Better Auth `databaseHooks.session.
create.before` hook provisions a user's organization + owner membership lazily on
their **first session** (i.e. at email+password signup) and stamps
`activeOrganizationId`; [ADR 0063](0063-new-org-default-provisioning.md) hangs
default-release assignment off that same moment via the `OrgProvisioningHook`
registry. So "a principal exists" and "a principal authenticated **with a
password**" are the same event in the code — the provisioning trigger is the
credential flow.

Enterprise SSO (SAML 2.0 / OIDC) and SCIM are the **#1 procurement
non-negotiable** for any IT-managed buyer, and they invert this: the identity is
owned by the customer's IdP, users arrive **JIT-provisioned or SCIM-pushed with
no Perimetra password at all**, and the org already exists (it maps to the
customer tenant, not to a self-signup). If provisioning stays coupled to the
email+password `session.create.before` path, adding SSO later is not a feature
bolt-on — it is a **tenant migration**: every already-onboarded org was created
through, and is shaped by, the password flow, and re-homing them onto an
IdP-federated model after the fact is the expensive, risky kind of change the
constitution says to avoid by building the correct seam up front.

The window to cut this seam cheaply is **now**: tenant count is ~1 (FIL is a
design partner, not yet a paying multi-seat tenant). The cost of the decouple
rises monotonically with every org onboarded onto the coupled model.

## Decision (proposed)

Introduce a **credential-agnostic provisioning seam** and route the existing
email+password flow through it, changing no observable behavior:

- **A `provisionWorkspace(principalId, opts)` operation** owned by the auth module
  (alongside `OrgProvisioningHook`) that creates org + owner membership + default-
  release assignment for a principal **regardless of how that principal
  authenticated**. The current `session.create.before` logic becomes the _first
  caller_ of this seam, not the home of the logic.
- **Provisioning keys on "a new principal needs a workspace", not on "a password
  signup happened".** Email+password signup calls the seam (unchanged behavior:
  same lazy auto-org, same `activeOrganizationId` stamping, same default-release
  assignment, same invite-first suppression of [ADR 0058](0058-invite-first-onboarding.md)).
  A future SSO/SCIM adapter calls the **same** seam for JIT/pushed users.
- **Org identity is decoupled from the credential.** An org is a tenant container
  that may be reached by password users, invited members, OR (later) IdP-federated
  users — the `organization` row and `member` graph carry no assumption that the
  owner authenticated with a password.
- **No SSO is built here.** This ADR cuts the seam and writes the contract; the
  SAML/OIDC/SCIM adapters remain Phase D, scoped to a concrete IT-managed buyer.

## Why this is a decision, not just a refactor

Cutting the seam is reversible-cheap **today** and irreversible-expensive **after
onboarding**. Recording it as an ADR (a) makes "decouple before onboarding real
tenants" an explicit gate rather than tribal knowledge, and (b) lets the eventual
SSO slice be a build on a prepared seam (effort `L`) instead of a tenant migration
(effort `XL` + data risk). It touches the live tenancy hooks (ADR 0055/0063), so —
per the go-gate — it ships only on Martin's explicit approval.

## Alternatives considered

- **Defer entirely (do nothing now).** Rejected as the default: onboarding real
  tenants on the coupled model is exactly what turns the SSO retrofit into a
  migration. The whole point is to act while the blast radius is one org.
- **Decide AND implement the decouple in this pass (autonomous).** Rejected for
  now: it mutates the live tenancy seam, which is a deliberate go-gate surface —
  the decision is recorded here for sign-off first.
- **Build SSO now.** Rejected: speculative depth before a concrete buyer; the
  strategy is sell-side breadth first (gap-analysis roadmap). Only the **seam**
  needs to exist early, not the federation.

## Consequences

- **On acceptance:** a behavior-preserving refactor extracts `provisionWorkspace`
  from the `session.create.before` hook (ADR 0055/0063), gated by the full test
  suite + the provisioning/onboarding itests proving email+password onboarding is
  byte-identical. Then SSO/SCIM (Phase D) builds on the seam.
- **Until accepted:** no change. The coupled model stands; this ADR is the
  recorded intent + the check that it must be resolved before tenant onboarding.
- **Governing modules (on implementation):** `apps/api/src/modules/auth/`
  (`auth.instance.ts` hooks, `org-provisioning-hook.ts`, `organizations.service.ts`).
  No schema change anticipated (org/member tables already credential-agnostic).
