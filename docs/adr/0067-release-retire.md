# ADR 0067 — Release retire + platform release-detail read

**Status:** Accepted (2026-06-19). Implemented. Closes the "release-retire
action" and "a platform release-detail endpoint" follow-ups that
[ADR 0061](0061-admin-publish-ui.md), [ADR 0062](0062-per-tenant-release-visibility.md),
and [ADR 0066](0066-vendor-broadcast-upgrade-offer.md) named as deferred. With
[ADR 0062–0066](0066-vendor-broadcast-upgrade-offer.md) the CORE_SPEC §3 release
lifecycle was already complete (assign → lazy-pin → tenant opt-in → vendor
broadcast); this adds the missing end-of-life transition + the operator's
read-any-release affordance.

## Context

The `release.status` column has carried `draft | published | retired` since the
store was built (CORE_SPEC §3 — "`published = frozen`"), but only `published`
was ever reachable: `publish` always freezes `status: "published"`, and there
was no way to take a version out of circulation. A vendor needs to retire a
version that is superseded, mispriced, or unsafe — without breaking the two
things §3 protects:

- **I3 — eternal reproducibility.** A quote stamps the exact `modelId@version`
  and must re-derive byte-identically forever. Retire therefore cannot delete or
  mutate the release body; re-derivation (`loadByReleaseId`, global) and the
  quote-issue gate (`assertAssigned`, set-membership) are both deliberately
  status-agnostic.
- **Tenants already on the version.** The hard question is what retire does to an
  org currently _pinned_ to the retired version.

Separately, the `/platform` console had no way to read an arbitrary release's
body: the only detail endpoint, tenant `GET /v1/releases/:id`, is org-scoped and
404s anything the caller's own org is not assigned — useless for an operator
inspecting a release across tenancy.

## Decision

- **Retire is NON-STRANDING — it governs DISCOVERY, not existing grants.**
  `POST /v1/platform/releases/:releaseId/retire` (SessionGuard + PlatformGuard,
  vendor-only like `publish`; actor = the operator) flips `published → retired`.
  A retired release is no longer **offered for new work**: it cannot be newly
  assigned, broadcast, or pinned (the `assign`/`broadcastAssign`/`pinVersion`
  guards already reject a non-published row — retire reuses them for free), and
  `getUpgradeOffers` drops it as an opt-in **target**. But an org already pinned
  to it **keeps configuring with it** — the configurator list
  (`listPinnedAssignedTo`) is intentionally NOT status-filtered. The vendor's
  lever to move tenants off a bad version is to publish a fix and **broadcast**
  it (ADR 0066), surfacing an opt-in offer — not a hard cutoff that strands live
  work. The alternative (hard retire = exclude from the configurator too) was
  considered and rejected: it strands a tenant mid-design for no I3 or safety
  gain the broadcast path does not already provide.

- **I3 is untouched.** The body is never mutated and the row is **never deleted**
  (the store stays append-only; `retired` is a column flip). A quote on a
  since-retired release reproduces forever — proven by `release-retire.itest.ts`
  (issue on `retire-demo@1` → `129891.504`, retire it, `verify` → `reproduced:
true`). `assertAssigned` and `loadByReleaseId` stay status-agnostic, so quote
  issue on a retired-but-pinned release still works (non-stranding, end to end).

- **Idempotent + race-safe, audited once.** `retire()` is `@Transactional()`
  (flip + audit commit together, ADR 0037). The repo write is a conditional
  `UPDATE … SET status='retired' WHERE release_id=? AND status='published'
RETURNING`: a `null` return means a concurrent retire won the race, so the
  service re-reads and returns idempotently **without** a second audit row. A
  re-retire of an already-retired release is a no-op `200` (no audit); a draft
  (not reachable via the publish API — seeded directly only in tests) `409`s. The
  endpoint returns **HTTP 200 for every path** (`@HttpCode(OK)`) — retire flips a
  column on an existing row, it never _creates_ one, so it follows the `verify`
  precedent, not the `assign`/`broadcast` 201s.

- **Platform release-detail is a GLOBAL read.** `GET /v1/platform/releases/:id`
  (PlatformGuard, `ParseUUIDPipe`) returns any release's full body +
  `initialInput` with **no assignment gate** — the operator tier sits above
  per-org scope (`getGlobal`, distinct from the tenant `get`'s assigned-only
  404). 404 only when the id genuinely does not exist. Keyed by the surrogate
  uuid (mirrors the tenant `get`), unlike broadcast/retire which take the natural
  key (each new route matches its closest sibling).

- **Nav links (minor).** `/admin` and `/platform` were URL-only; the account page
  now shows them conditionally via `useIsAdmin()` (org `role==='admin'`) and
  `usePlatformAdmin()` (`isPlatformAdmin`), both read from `/v1/me` and
  FAIL-CLOSED while loading/anonymous — defense-in-depth UX, the server stays the
  authority.

## Consequences

- The vendor opens `/platform`, expands a release to inspect its body (the global
  detail read), and clicks **Retire** (a one-way transition guarded by an explicit
  confirm — there is no un-retire endpoint). The version stops being offered to
  anyone new; orgs already on it are unaffected; historical quotes reproduce.
- No schema change — `retired` already existed; no migration. `AssignedReleaseMeta`
  gains `status` so `getUpgradeOffers` can skip a retired upgrade target (a still-
  published older pin still surfaces a published upgrade if one exists).
- The OpenAPI snapshot gains the two routes (retire `200`, detail `200`).
- The §3 release lifecycle is now end-to-end: publish → assign → lazy-pin → tenant
  opt-in → vendor broadcast → **retire**.
- **Deferred:** un-retire / re-publish-a-fixed-version flow (broadcast covers the
  move-forward path today); the **structured release editor** (raw-JSON publish on
  `/platform` still stands — a deep multi-phase form deserving its own slice);
  `adjustability: tenant`; issue-key i18n + deviation-override UX.

Governing module: `apps/api/src/modules/releases/` (service + repo) and
`apps/api/src/modules/platform/` (the two endpoints). No schema change.
