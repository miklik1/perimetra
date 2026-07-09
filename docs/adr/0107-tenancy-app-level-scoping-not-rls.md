# ADR 0107 — Tenant isolation stays app-level (scoped repositories); RLS / FORCE-RLS rejected

**Status:** Accepted (2026-07-08). Records the as-built decision (no code change);
couples ADR 0038 (pooling) with ADR 0041 (tenancy seam).

> Drained from **skeleton ADR 0049** (channel A, `1185fe7`) and renumbered —
> perimetra's 0049 is site-graph composition. Future upstream commits citing
> "ADR 0049" in tenancy/repository code refer to THIS decision.

## Context

An Anyora whole-repo review flagged **FORCE ROW LEVEL SECURITY** as skeleton-owed
hardening (vault finding "Whole-repo review — recurring backend bug classes",
2026-06). The argument is sound in the abstract: Postgres RLS with `FORCE` makes
the **database** enforce tenant isolation, so even a forgotten `WHERE org_id = …`
in application code cannot leak across tenants — defense-in-depth the app-level
approach lacks. The finding sat open against this skeleton.

Grounding it against the code: this skeleton has **no RLS**. Tenancy is a
scoped-repository seam (ADR 0041) — a `RequestScope` carries `orgId` and every
repository query is org-scoped in application code; the org feature is dormant by
design. Adopting RLS would require a per-request tenant identifier visible to
Postgres, i.e. a **session GUC** (`SET app.current_org = …`) per transaction.
That directly conflicts with the pooling doctrine (ADR 0038): the skeleton is
**transaction-pooling-safe by mandate** — no session GUCs, no `LISTEN/NOTIFY`, no
prepared-statement reliance — precisely so it runs under a transaction pooler
(PgBouncer / Supavisor) where a connection is not stable across statements. A
naive `SET` GUC there can leak to another tenant's transaction on a recycled
connection: RLS-via-session-GUC is _unsafe_ under the very pooling posture the
skeleton commits to.

## Decision

Tenant isolation **stays app-level** via the scoped-repository seam (ADR 0041).
**RLS / FORCE-RLS is rejected** for the skeleton because its GUC requirement is
incompatible with the transaction-pooling doctrine (ADR 0038). This is a
deliberate divergence from Anyora, which accepted a stricter pooling posture to
gain RLS defense-in-depth.

The app-level guarantee is two existing mechanisms together (ADR 0039 / 0041):
org-scoped repositories, and every endpoint returning through a zod response
schema (strip semantics — an un-scoped `select()` still can't ship a foreign
row's fields). A derived project MAY adopt RLS + FORCE with its **own ADR
superseding this one for that repo** if it either (a) keeps the tenant GUC
transaction-local under a pooler that honours it (e.g. Supavisor transaction
mode + `SET LOCAL`, verified), or (b) accepts session pooling.

## Consequences

- **No code change** — this records the decision so the finding stops resurfacing
  as "skeleton-owed."
- The pooling doctrine (ADR 0038) and this decision are **coupled**: a future
  skeleton feature that needs DB-enforced isolation must revisit ADR 0038 first.
- The Anyora RLS work stays Anyora-local (its pooling posture differs); this ADR
  is the fleet reference for _why_ the skeleton does not mirror it.

## Sources

- Vault finding "Whole-repo review — recurring backend bug classes (Anyora
  2026-06)".
- ADR 0038 (zero-downtime migrations + pooling doctrine) · ADR 0041 (tenancy
  seam: scoped repositories) · ADR 0039 (mandatory zod response serialization).
