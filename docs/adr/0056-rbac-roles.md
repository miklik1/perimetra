# ADR 0056 — RBAC on org membership (roles, price-blind, margin floor, publish gate)

**Status:** Accepted (2026-06-14). Implemented. Builds on the live org scope of
ADR 0055 (which deliberately deferred roles).

## Context

ADR 0055 activated the org boundary (`scoped()` filters `organizationId`) but
left every member equally privileged. Step 6 needs real authorization within an
org: a fabricator's admin, salespeople, and workshop staff are not the same. The
domain (CORE_SPEC §7) calls for three roles — admin / sales / workshop — with the
workshop **price-blind**, the **margin floor** as the single lightweight approval
mechanism, and publish (releases/catalog) restricted. Two prior findings shaped
the design: a Better-Auth admin-field leak (price-blind MUST be a server-side DTO,
never FE hiding) and the entitlement-gate pattern (gate by config, fail closed,
prove in an itest).

## Decision

- **Role is membership-scoped, not global.** The role lives on the existing
  `member.role` column (a user WITHIN one org), never a `users.role`. This is the
  inverse of the "no global role enum" rule, not a violation of it: a global role
  on the user is banned; a role scoped to one membership is the correct per-tenant
  shape. Better Auth's auto-provisioned `owner` maps to `admin`. The mapping is
  one function (`mapMemberRole`, `common/rbac/org-role.ts`): `owner`/`admin`→admin,
  `sales`→sales, `workshop`→workshop, anything else → `null` (fail-closed).

- **One guard, fail-closed, fresh from the DB.** `RolesGuard` (auth module) runs
  after `SessionGuard`. It resolves the caller's active-org role via
  `MembershipService.resolveRole(scope)` — an authoritative `(userId,
organizationId)` lookup on `member`, NOT a session-cached value, so an admin
  changing a member's role takes effect on the member's next request. It attaches
  the role to the request (`@CurrentRole()`) and, when the route carries
  `@RequireRole(...)`, 403s a role outside the set. A session with no resolvable
  org role is 403'd even on un-annotated routes — an authenticated non-member has
  no business reaching tenant data.

- **Workshop is price-blind SERVER-SIDE.** Quote read/list strip price/margin at
  the response boundary for `workshop`: `total → null`, and the frozen snapshot
  loses `money`, `totals`, and every per-line price (`totalPrice`,
  `totalPriceMoney`) — geometry/specs (BOM items + quantities, cut list, drawings,
  site, inputs) remain. The price never crosses the wire to a workshop client.
  Price tables (pure prices) are gated to admin+sales outright; workshop is 403.

- **Margin-floor issue guard + admin override.** `quotes.issue` blocks (422,
  `margin_below_floor`) when the derived margin is below the org floor. An `admin`
  may issue anyway by supplying `marginOverride.reason`, audited as
  `quote.margin_override` on the quote; sales has no override path. The floor is a
  single env-backed constant (`QUOTE_MARGIN_FLOOR_PCT`, default `0` = inert) — a
  per-org floor lands later. The margin model is an honest, isolated PROXY: the
  engine has no cost basis yet (the price table carries SELL prices only), so true
  `(price − cost)/price` is not computable. We use the fabricator's value-add
  (manufacturing + installation) over revenue as the margin — material/accessory is
  the cost-like pass-through, labour is the margin. `quoteMarginPct` is the one
  swap point when a cost model arrives. The guard reads the derived totals only; it
  never touches derivation, so reproducibility (golden `129891.504`) is unchanged.

- **Admin publish gate.** `POST /releases`, `/catalog-versions`, and
  `/price-tables` carry `@RequireRole("admin")` — closing the slot-poisoning hole
  the authenticated-only surface left open (slot-poisoning was tolerable only
  because there are no real tenants pre-launch).

- **FE mirrors the SAME role from the SAME source.** `GET /v1/me` returns the
  active-org role; `useRole()`/`usePriceBlind()` read it and hide prices in the
  configurator + site result panels. The mirror is FAIL-CLOSED (prices show only
  for a confirmed admin/sales) and is defence-in-depth — the server is the
  authority. No schema change: roles ride the column ADR 0055 already shipped.

## Consequences

- **Enforcement is proven, not asserted.** `roles.itest.ts` flips one user's
  `member.role` and asserts the matrix with zero code between cases: admin issues/
  publishes/sees prices/overrides; sales issues + sees prices but publish 403 + no
  override; workshop reads price-null + issue 403 + publish 403 + price-tables 403.
  A second app pins the floor to 99% to exercise the guard and the audited override.

- **Role changes need a member already in the org.** With no invite flow yet
  (ADR 0055), every user is the sole `owner`/admin of their own org; multi-role
  orgs are reachable only by writing `member.role` directly (as the itest does).
  The invite/role-management UI is the next slice; the guard + DTO + matrix are
  ready for it.

- **The margin number is a placeholder, by design.** It is a value-add proxy, not
  a real margin, and defaults to inert (floor 0). Shipping an aggressive default on
  a proxy would wrongly block real quotes — so the mechanism exists and is tested,
  while the meaningful default waits for the cost-model slice.

- Org scope (ADR 0055) gates _which_ rows; roles gate _what_ a member may do with
  them and _which fields_ they see. Derivation and I3 reproducibility are untouched.
