# ADR 0054 — Project site persistence: project.site + project_instance roster

**Status:** Accepted (2026-06-13). Implemented in step 6 slice 3c (the project-
persistence follow-up deferred from ADR 0053). Scope: persistence only —
api-served vendor releases/catalog/prices stay deferred to the admin-publish
slice.

## Context

The site canvas (ADR 0052) and configurator (ADR 0051) are fed entirely from the
interim `@repo/fixtures` source: `apps/web/app/site/initial.ts` seeds the Site
graph + instance roster into React state, lost on reload. ADR 0053 productized
the quote (immutable stores + re-derivable snapshot) and left a matching seam on
`issueQuoteSchema` — `projectId` "Nullable until project persistence lands" — and
on the `quote` table. A project that cannot persist its own designed site is the
missing half: there is no durable thing a quote is issued _from_.

CORE_SPEC frames a project as a designed site — a plot of connected, configured
instances. Persisting that is the first step-6 follow-up (the others: org-scope
retrofit ADR 0041, roles, api-served catalog). This ADR records the persistence
shape only; the canvas keeps reading vendor releases from `@repo/fixtures` (the
⌛ that the admin-publish slice retires).

## Decision

1. **A project owns its site as `project.site` (JSONB) + a `project_instance`
   roster table.** The Site graph (terrain/placements/connections) is a single
   opaque JSONB column on `project` (NULL until designed); the per-instance
   roster — `{ instanceId, releaseId, input, overrides? }` — is a child table,
   `UNIQUE(project_id, instance_id)`, `ON DELETE CASCADE`. The roster keys to the
   graph's placements by `instanceId`. The roster is normalized (not JSON on the
   project) so it has integrity and a query handle, and because it is the
   durable, release-pinned form the canvas's product-index addressing is _not_.

2. **`project_instance` carries no ownership scope of its own.** It is a child
   of `project` and is only ever read/written through the owning project, whose
   `scoped()` filter (ADR 0041 seam) is the access gate. The org retrofit flips
   `project.scoped()` and the roster inherits it — no second scope to migrate.

3. **Full-document GET/PUT, transactional, audited — no granular instance CRUD.**
   The canvas holds the whole site in memory and re-derives per edit (pure
   engine, I1); persistence is one `GET :id/site` load and one `PUT :id/site`
   save. `saveSite` confirms ownership via `updateSite` (404 on miss) _before_
   touching the roster, then replaces site + roster in ONE `@Transactional()`, so
   the two never diverge. PUT is naturally idempotent (same body → same state),
   so no Idempotency-Key. The save is audited with a light diff (instance count)
   — the Site blob is too large to diff usefully, and the immutable quote
   snapshot is the real reproducibility record (I3).

4. **The site blob is never engine-validated at the persistence boundary.** It
   crosses as `z.unknown()` (the same stance as the quote `snapshot`/`site`): the
   engine is the validation gate (I5), and the canvas legitimately persists
   invalid-but-editable sites — the "two truths" of ADR 0052, where a bad
   connection invalidates the aggregate while per-instance footprints stay
   editable. Persistence must round-trip a half-built site untouched.

5. **The roster entry mirrors `quoteInstanceInputSchema`.** `projectInstanceSchema`
   is defined independently in `@repo/validators/projects` (so the two can
   evolve) but is structurally identical, so a saved project's `{ site,
instances }` feeds `quotes.issue` directly — closing the `projectId` seam
   ADR 0053 left open.

6. **`/site` becomes project-scoped: `/site/:projectId`.** The RSC loads the
   saved site as the user (cookie-forwarded in-process fetch) and prop-passes the
   canvas's editable shape — no client refetch, the canvas is a local-edit island
   that saves back explicitly. 404 → `notFound()` (no existence oracle); 401 →
   empty shell + the client `AuthGuard` redirects to `/login` (the same
   best-effort resilience the projects page prefetch has). The
   `releaseId ↔ productIndex` translation lives in one module
   (`app/site/persistence.ts`); an unknown release id is dropped on load (and its
   placement pruned) so a stale pin can't crash the canvas before releases are
   api-served.

`initial.ts` is demoted from the canvas's source-of-truth to a one-click "Load
demo" populate (the golden 129 891.504 roster), still authored from
`@repo/fixtures`.

## Consequences

- A project is now a durable, re-openable designed site, and the quote lifecycle
  has a real `projectId` to issue from.
- `@repo/fixtures` remains the ⌛ interim VENDOR release/catalog/price source for
  the web runtime — explicitly out of scope here; the admin-publish slice
  (api-served catalog + the publish RoleGuard) retires it.
- Adding a domain `site` column to the ADR-0039 reference `project` table is
  accepted: `project` is the projects domain table, not a generic template, and a
  real domain table carries domain columns. The reference value is in its
  id/owner/timestamps/scoping conventions, which are unchanged.
- The migration is purely additive (nullable column + new table) — expand/
  contract, N−1 compatible (`migrations.itest` green).

## Alternatives considered

- **Roster as JSON on `project` (no child table).** Simpler load/save, but no
  integrity (`UNIQUE`/cascade) and no query handle, and it conflates the durable
  release-pinned form with the opaque graph. Rejected — the normalized roster is
  the enterprise-correct shape and matches the decided design.
- **A 1:1 `project_site` table instead of a column.** Keeps `project` pristine
  but adds a join to every load for no integrity gain (site is genuinely 1:1).
  Rejected — see Consequences.
- **Granular per-instance CRUD endpoints.** Mismatches how the canvas mutates
  (whole document in memory) and multiplies the transactional surface. Rejected
  in favour of full-document PUT.
- **Full fixtures retirement this slice (api-served releases/catalog/prices).**
  Much larger, requires seeding the immutable stores + web data-fetching for all
  vendor data, and overlaps the admin-publish-gate follow-up. Deferred.

## References

- CORE_SPEC §6 (quote/project), §8 (site), invariants I1/I3/I5/I10.
- ADR 0041 (org-scope seam), 0049 (site graph), 0052 (site canvas, two truths),
  0053 (quote lifecycle, the `projectId` seam this closes).
- `apps/api/src/modules/projects/CONTEXT.md` (the site-persistence rules).
