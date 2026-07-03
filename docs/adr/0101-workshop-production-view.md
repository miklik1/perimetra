# ADR 0101 — Workshop production view

**Status:** Accepted (2026-07-04). A workshop-facing, ALWAYS price-blind PRODUCTION
view of an issued/accepted quote — cut list, BOM quantities, 2D drawings — served
by a NEW `GET /v1/quotes/:id/production` and rendered at `/quotes/:id/production`.
Built off the quote's FROZEN snapshot (I3: never re-derived — a since-changed
price table/release must not alter what gets built). The load-bearing decision
is the same as ADR 0089's: the backend projects an ALLOWLIST shape and returns
only it, so cost/margin/customer-PII never cross, even by omission-mistake.

## Context

CAR-24 asked for a fabricator build surface. Two existing facts shaped the design:

- **The quote detail (`GET /v1/quotes/:id`) is already role-aware** —
  `toDetail`/`blindSnapshot` (quotes.service.ts, ADR 0056) strip money for the
  `workshop` role server-side. So the "existing DTO is price-bearing" framing is
  only half true: the _type_ (`snapshot: z.unknown()`) is opaque passthrough, but
  the _runtime_ already whitelists bom/cutList/drawings/inputs/site/cutOptions for
  workshop. A dedicated production surface still earns its keep: a STRUCTURED,
  typed, role-**independent** shape (production has no price to hide from
  admin/sales either — it's a distinct SURFACE, not a permission level) is a
  stronger contract than "workshop happens to get an opaque object with the money
  fields missing."
- **Workshop's ownership scoping was a latent dead end.** `scopeOpts(role)` was
  `restrictToOwner: role !== "admin"` — narrowing BOTH `sales` (correct: their own
  pipeline) AND `workshop` (wrong: workshop never issues, `@RequireRole("admin",
"sales")` on `issue`, so a workshop-owned quote never exists). The nav entry
  ("quotes", CAR-12) was already visible to any org member, and the onboarding
  smoke test proved workshop's list 200s — but scoped to zero rows in practice.

## Decision

**`scopeOpts` widened**: `restrictToOwner: role === "sales"`. Ownership narrowing
is a sales-pipeline concept; `admin` and `workshop` both see the whole org. This
is a single-line change in `quotes.service.ts`, applied to `list`/`get`/the new
`getProduction` alike — the SAME scope, not a parallel rule for production only.

**`GET /v1/quotes/:id/production`** on the existing `QuotesController`, no
`@RequireRole` (same as `get`) — admin/sales/workshop all reach it. Gated to an
effectively `issued`/`accepted` quote (`isProducible`, `apps/api/.../quotes/
production.ts`); a draft/declined/expired quote 404s — absence, not a 403,
matching the org-scope-isolation "no existence oracle" precedent.

**The response is a NEW, fully structured `quoteProductionSchema`** (`@repo/
validators/quotes`) — hand-mirrored off `@repo/renderers` (`CutList`,
`WorkshopDrawing`, `SitePlan`) and `@repo/engine` (`SiteBomLine`), the same
mirroring discipline `taxBreakdownSchema`/`nabidkaDocumentSchema` already use
(`@repo/validators` cannot depend on renderers/engine/model — the boundaries DAG
keeps it a zero-dep leaf). `productionBomLineSchema` drops `totalPrice`/
`totalPriceMoney`; `cutList`/`drawings` carry no price fields by construction of
the renderer output itself.

**A narrow leak vector, closed:** a part's cascade override can target the
COMMERCIAL `ArtifactField`s `pricePerUnit`/`totalPrice` (@repo/model), not just
the physical `quantity`/`lengthMm` — so an overridden part would otherwise carry
a raw price float into `drawings.instances[id].flags` via `PartDeviation`.
`production.ts`'s `productionSafeDrawing` filters flags to the two physical
fields; `productionDrawingFlagSchema`'s `field` enum (`"quantity"|"lengthMm"`)
is the schema-level backstop — a smuggled commercial flag fails closed (a
validation error), never silently serializes. Applied to `blindSnapshot` too
(the existing workshop detail path), for the same defense-in-depth reason.

**Pure projection, unit-tested standalone**: `apps/api/src/modules/quotes/
production.ts` (`isProducible`, `productionSafeDrawing`, `toProduction`) mirrors
the `quote-lifecycle.ts`/`document-number.ts` pattern — extracted, zero-I/O,
its own `.test.ts`. `quotes.service.ts`'s `getProduction` is a thin orchestrator:
load (widened scope) → gate (`isProducible`) → project (`toProduction`).

**Non-leak test** (`test/quotes-production.itest.ts`) introduces a RECURSIVE key
scan (`collectKeys`) asserting zero keys matching `/price|cost|margin/i` anywhere
in the response, generalising the flat `res.body.not.toContain(...)` idiom the
buyer-nabídka test (ADR 0089) used — plus the golden money strings (`129891.5`,
the cost golden `79039.86`) never appear as substrings, and role-identical-shape

- org-isolation + lifecycle-gating (draft/declined/expired 404, accepted 200)
  are covered.

**Web**: `/quotes/[id]/production` mirrors the priced detail's RSC-prefetch +
`HydrationBoundary` + client-component structure exactly (not the simpler
RSC-only nabídka print pattern — production is read-only today but is the
workshop's PRIMARY surface, more likely to gain interactivity later, and reuses
the module's established `defineQuery` factory). The view reuses the
configurator's own `WorkshopDrawingSvg`/`SitePlanSvg` (ADR 0077, no second
drawing implementation) and adds two new presentational pieces: a BOM-quantities
table (inline in `production-view.tsx`) and `cut-list-panel.tsx` (lines +
FFD-nesting bars + oversize pieces — the first cut-list UI in the app; the
configurator never surfaced one).

**Nav**: no registry change. `lib/nav-registry.ts`'s "quotes" entry was already
visible to any org member (documented there: "a workshop user can still open a
quote to see its geometry/specs, just not its price") — CAR-24 makes that
entry-point actually useful by widening the list's scope (above) and having
`QuotesList` route a `workshop` role's row `Link` to `/production` instead of
`/quotes/:id` (via `useRole()`). The priced detail (`quote-detail.tsx`) gains a
"Production" cross-link next to the existing nabídka one, gated the same
`issued`/`accepted` condition as the endpoint (so it never dangles into a 404).

**Not done**: no `@repo/api-mocks` handler for the new endpoint (mock-mode dev
does not yet serve `/production`) — a deliberate scope cut, not an oversight;
add one if mock-mode coverage of this surface is needed later. No route-registry
entry (`packages/navigation/src/routes.ts`) — mirrors the existing `nabidka`
sub-route precedent (a raw `Link href` string), not every per-quote sub-route is
registered there.

## Consequences

- Workshop's `/quotes` list and detail, previously silently empty in practice,
  now show the org's quotes (existing behavior for admin/sales unchanged; sales
  still sees only its own pipeline).
- Production is a genuinely new invariant to maintain: any FUTURE snapshot field
  must be reasoned about against BOTH `blindSnapshot`'s and `toProduction`'s
  allowlists, not just one — the two now share the `productionSafeDrawing` drawing
  filter, but the top-level field lists are separately maintained (whitelist, not
  blacklist, is the discipline that makes this safe by construction rather than
  by remembering to update two places).
- I3 holds: production is a read-only projection over the immutable snapshot;
  `verifyReproducibility`'s checks are untouched.
