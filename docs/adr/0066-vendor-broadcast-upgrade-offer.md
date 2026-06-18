# ADR 0066 — Vendor-broadcast upgrade-offer fan-out

**Status:** Accepted (2026-06-18). Implemented. Closes the "vendor-initiated
offer-this-upgrade-to-all-orgs-on-the-prior-version fan-out" deferral that
[ADR 0064](0064-release-version-pin.md) and [ADR 0065](0065-per-release-catalog.md)
left open — the last piece of the CORE_SPEC §3 release lifecycle.

## Context

[ADR 0064](0064-release-version-pin.md) gave each tenant org a per-model pin
(active version) and an explicit opt-in (`POST /v1/releases/pin`). The vendor
makes a new version AVAILABLE by assigning it
(`POST /v1/platform/organizations/:orgId/releases`), which surfaces an "upgrade
available" offer (`GET /v1/releases/upgrades`); the tenant then opts in.
[ADR 0065](0065-per-release-catalog.md) removed the last structural reason a
mixed-version org was illegal (per-release catalog), so the offer is always a
legal state.

What was missing is the vendor's side at scale: to offer `@2` to every org still
on `@1`, the operator had to POST the per-org assign endpoint once per org by
hand. Both prior ADRs named this fan-out as deferred.

The hard constraints carry over unchanged:

- **A broadcast must NEVER move a pin.** §3 — "upgrades are explicit opt-in per
  tenant." The broadcast only makes the version available; the pin moves only on
  the tenant's own `pinVersion`.
- **I3 ≠ visibility ≠ pin.** A broadcast touches only the disposable
  `org_release_assignment` + (lazily) `org_model_pin`; never `release`, `quote`,
  `SiteStamps`, or `project_instance.releaseId`. A quote re-derives byte-
  identically regardless.
- **`assertAssigned` stays set-membership.** After a broadcast both the old and
  new versions are assigned and quotable; the pin still governs only the default
  offer.

## Decision

- **One platform action, server-derived targeting.**
  `POST /v1/platform/releases/:releaseId/broadcast` (SessionGuard + PlatformGuard,
  no org scope; actor = the operator's session user). The targets are derived in
  the DB, NEVER supplied by the caller: every org **pinned to a strictly-older
  version of the broadcast release's model** (`findOrgsBehindOnModel(modelId,
version)` = `org_model_pin ⋈ release` on the version compare). Targeting by the
  PIN (active version) — not by assignment — is the precise "orgs actually on an
  older version" semantic, and the `< version` compare catches orgs several
  versions behind in one call. No client-supplied "prior version" to validate or
  trust.

- **Reuse the single-assign path; never a new pin-moving path.** The broadcast
  loops calling the SAME write a single assign uses (`assignValidated` →
  repo `assign` + `ensurePin`, both `ON CONFLICT DO NOTHING`). `ensurePin` is the
  lazy first-pin only; a targeted org (which already has a pin for the model)
  keeps it, and the new version surfaces through the existing `getUpgradeOffers`
  with zero extra code. This makes "never moves a pin" structural, not a guard.

- **Validate once, fan out per-org-isolated.** The new release is validated up
  front (exists + published → fail HARD 404/409, before any write) and the row is
  reused for every org. The loop is deliberately NOT wrapped in one outer
  `@Transactional()`: each `assignValidated` is its own transactional unit, so a
  partial failure leaves prior orgs committed and the whole thing is idempotent (a
  re-broadcast is a no-op — already-assigned orgs are reported `skippedOrgIds`).
  Returns `{ releaseId, assignedOrgIds, skippedOrgIds }`.

- **Per-org errors propagate; we do not catch driver codes.** A bulk op must never
  mask an infra fault (DB down, pool exhausted) as success. The one benign case
  this also surfaces is a concurrent org hard-delete (the pin is read, then the
  org + pin CASCADE-deleted, so that org's assign FK-fails). Rather than couple the
  service to the pg driver's `23503` (an FK-violation translation is a repository
  concern), we let it propagate: partial progress is committed, the run is
  idempotent, and a retry completes cleanly (the deleted org has dropped out of the
  target set). The race window is sub-second over a small trusted-tenant fleet.

- **Synchronous loop, not the outbox.** Scale is a handful of fabricators
  (`OrganizationsService.listAll` is deliberately unpaginated for the same reason).
  The synchronous fan-out is correct; the outbox/worker path (emit an event in a
  tx, fan out with `cls.run` per org) is the documented fallback if tenant count
  ever grows, and is intentionally NOT built (YAGNI).

## Consequences

- The vendor publishes `gate@2`, clicks **Broadcast** once on `/platform`, and
  every org on `gate@1` immediately sees the "Upgrade to v2" offer in `/admin` —
  none of their pins move; each opts in on its own. Orgs already on `@2`, and orgs
  on a different model, are never targeted.
- I3 holds across the fan-out: a quote issued on `@1` reproduces `129891.504`
  through the broadcast (proven by `release-broadcast.itest.ts`).
- Schema is expand-only: one additive index `org_model_pin_model_idx` on
  `(model_id)` to keep `findOrgsBehindOnModel` off a full scan (the existing unique
  index leads with `organization_id`). N-1-safe; `lock_timeout` set.
- `assign()` now returns whether a new assignment was inserted (was `void`) so the
  broadcast can report assigned-vs-already-assigned; single-org callers ignore it.
- **Deferred:** none for the release lifecycle. Adjacent step-6 follow-ups remain
  (release-retire, structured release editor, a platform release-detail endpoint).

Governing module: `apps/api/src/modules/releases/` (service + repo) and
`apps/api/src/modules/platform/` (the endpoint). Schema:
`packages/db/src/schema/releases/index.ts` (`org_model_pin_model_idx`).
