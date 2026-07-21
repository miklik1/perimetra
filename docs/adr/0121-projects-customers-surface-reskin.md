# ADR 0121 — The Projekty (projects) + Zákazníci (customers) surface reskin: two parallel list surfaces, and the shared o-LIST horizontal-overflow fix

**Status:** Accepted (2026-07-21 — W7 Phase 2, surfaces 3+4, delivered through the
reskin-wave). Follows [ADR 0119](0119-orders-surface-reskin.md) (which established
the wave method and the two per-surface fixes) and [ADR 0120](0120-quotes-surface-reskin.md),
applying the design authority ([ADR 0114](0114-design-canvas-adoption.md)) to the
two least-styled internal surfaces. `design/README.md` §4.2/§5 govern the IA and
scope; §6 the list language; §3.2 the detail language; §12 the ship bar.

## Context

Neither surface has a bespoke canvas board. Per `design/README.md` §4.2, `/projects`
is **Nabídky ▸ tab Rozpracované** and `/customers` is **Poptávky ▸ tab Zákazníci**.
The authorities are therefore the shipped o-LIST table language (ADR 0119/0120), the
settings-layout idiom, and — for the customer detail — the Nabídka document language
from the quotes detail (ADR 0120).

They were the least-styled surfaces in the app. `/projects` carried the _oldest_
scaffolding idiom (plain `<ul>`, `text-2xl font-bold` title, `min-h-screen` main,
almost no kit). `/customers` was partially migrated (already `DisplayLabel`/`Panel`/
`Button`) but its `CustomerForm` was explicitly flagged "functional-minimal (out of
scope per CAR-23)" — deliberately unstyled, awaiting exactly this reskin.

A structural asymmetry drove the design: **`/projects` is list-only** — its detail is
`/site/[projectId]`, which §5 fences OUT (reskinned app shell only). **`/customers`
is list + detail** (`/customers/[id]`). So the two lists diverge in how they carry
per-row actions (below).

## Decision

Delivered as ONE parallel wave (a single Workflow: a sequential i18n seed → three
disjoint builders → cold gate → adversarial review → skeptic → fix), LOOK + honest
gap-fill, **no schema change, no backend behaviour change**:

1. **`/projects` list** — reskinned to the o-LIST table (Název · Popis · Stav ·
   Vytvořeno · actions) inside the settings-layout idiom with the per-branch min-h
   fix; the create form migrated to kit `Field`/`Input`/`Textarea`. Název is a
   stretched-link → `/site/:id`; Stav is a status `Badge` (AKTIVNÍ/ARCHIVOVÁNO).
   **Divergence from the pure-nav orders o-LIST:** projects rows carry inline
   Archivovat/Smazat actions in a trailing cell layered above the stretched link
   (`relative z-10`), because projects has **no in-surface detail** to relocate the
   actions to.

2. **`/customers` list** — reskinned to the o-LIST table (Zákazník · IČO · Město ·
   Stav). It stays **pure-nav** — the whole row is one stretched-link → `/customers/:id`;
   archive/restore live on the detail. The deferred search (`useDeferredValue`) is
   restyled to a kit `Input type="search"`. Per-rep role scope, the workshop
   403→notice, and the `/customers/:id` 404-no-oracle are untouched.

3. **`/customers/[id]` detail** — the quotes-detail language, lighter: a titleband
   (back-link → `/customers`, `DisplayLabel` name, status `Badge`, archive/restore
   action) over the shared `CustomerForm`, regrouped into sectioned `Panel`s —
   **Identifikace** (Název, IČO/DIČ, Plátce DPH as a kit `Switch`), **Kontakt**,
   **Adresa**, **Poznámka** (kit `Textarea`) — every field migrated to kit
   primitives. The ARES prefill (`useAresLookup`) and VIES badge (`useViesLookup`)
   are preserved; the create-vs-edit branch (POST when no `initial`, PATCH otherwise)
   is byte-identical.

The i18n keys were seeded by a sequential first agent so the three parallel builders
never collided on the catalogs. The gate passed on the **first** try (0 fix rounds:
check-types, lint, web vitest, build, knip). The adversarial review ran three
independent opus dimensions — PII/role/behaviour, design/a11y, i18n/tests — and each
found **zero** defects (the price-leak hunt of the money surfaces was replaced here by
a PII/role-scope hunt, since these surfaces carry customer PII and per-rep ownership).

## The shared o-LIST horizontal-overflow fix (the load-bearing engineering finding)

Main-loop eyes-on caught a defect the green gate and the review missed: the `/projects`
list overflowed the document horizontally at the 390 px phone width (`documentElement`
`scrollWidth` 660 > 390), in **both** themes. `/customers` did not.

**Root cause.** The o-LIST row is a stretched-link — a `<Link>` with
`after:absolute after:inset-0`, positioned against the `relative` `<tr>` so the whole
row is one click target and one tab stop. When the table's min-content width exceeds
the viewport (projects' Archivovat/Smazat actions cell is `whitespace-nowrap`, forcing
a ~636 px table), the absolutely-positioned `::after` pseudo-elements are **not clipped
by the `overflow-x-auto` wrapper**, because that wrapper is not a containing block for
them — so they escape to the document and create horizontal body scroll, even though
the table itself is a scroll container. This was proven by direct measurement, not
inference (a headless probe reported the wrapper at 342 px with `scrollWidth` 636 while
the document sat at 660).

**Fix.** Two classes on the shared scroll wrapper: `min-w-0` (lets the flex-item
wrapper shrink below its content's cross-axis automatic minimum and actually scroll)

- `relative` (makes the wrapper the clip / containing-block boundary, so the
  stretched-link pseudos are clipped inside the scroll container). Measurement after the
  fix: document `scrollWidth` 390 — the wide table scrolls inside its card, the body does
  not move.

Applied to **all four** o-LIST surfaces — `projects`, `customers`, `orders`, `quotes`.
Orders and quotes never exposed the bug only because their tables fit under 390 px; the
latent defect is real (any long column or a future actions cell would trip it), and the
hardening is a visual no-op where content already fits. Recorded as a reusable vault
Engineering finding (flex cross-axis `min-w-0` + stretched-link `::after` clip).

## Recorded deviations from the export (§11.2)

1. **Projects keeps inline row actions in a trailing cell layered above the stretched
   link** — diverging from the pure-nav orders/quotes o-LIST — because `/projects` has
   no in-surface detail (`/site/[projectId]` is fenced OUT) to host Archivovat/Smazat.
2. **Customers is pure-nav (actions on the detail).** The customers-vs-projects list
   split is intentional: customers has a detail to carry the actions; projects does not.
3. **Columns are thin-schema honest.** Projects: Název/Popis/Stav/Vytvořeno. Customers:
   Zákazník/IČO/Město/Stav — the detail holds the rest. A `?? "—"` fallback renders for
   a null IČO or city; a null project description renders an empty Popis cell.
4. **No KPI tiles / aggregates** — no honest aggregate endpoint exists, matching ADR 0119.
5. **ADR-0111 status tones kept** (AKTIVNÍ/ARCHIVOVÁNO), consistent with the wave.
6. **No in-page tab strip.** The §4.2 Rozpracované/Zákazníci section IA is owned by the
   app-shell nav ([ADR 0118](0118-authenticated-app-shell.md)), same as orders/quotes.
7. **The projects detail (`/site/[projectId]`) stays OUT** — reskinned app shell only,
   contents untouched (§5 fence).
8. **The customers `CustomerForm` was migrated off its "functional-minimal (out of scope
   per CAR-23)" placeholder** to kit primitives and sectioned Panels; all behaviour
   (create/edit branch, ARES/VIES, archive/restore, 404-no-oracle) is byte-identical.

## Consequences

- No schema change; no backend behaviour changed; per-rep role scope, the workshop
  403→notice, PII handling, optimistic archive/delete, keyset paging, the deferred
  search, and the idempotency-keyed create are all preserved. The adversarial
  PII/role/behaviour pass confirmed no query widening, no PII leak into logs/DTOs, and
  no drift in the access gates.
- The **shared o-LIST wrapper is hardened across all four list surfaces** (the
  flex/absolute-overflow finding) — a latent horizontal-scroll bug that projects was the
  first surface wide enough to expose.
- Eyes-on cleared in both themes at all six ship-bar widths: `/projects` (desktop o-LIST,
  the phone table now scrolling inside its card, the empty Popis cell, the archived-muted
  row with no Archivovat), `/customers` (the "—" IČO/city fallbacks, the archived row),
  and the sectioned `/customers/:id` detail (titleband + Identifikace/Kontakt/Adresa/
  Poznámka Panels, the Plátce DPH `Switch`, ARES prefill + the VIES "Ověřuji DIČ…" state).
  No horizontal body scroll after the fix; dark resolves fully. Only console noise is the
  known local realtime-WS `:3000`↔`:3002` drift and the VIES-lookup unmount abort. A
  reusable `capture-projects-customers.mjs` instrument is added (+ its knip entry).
- The full gate is green: check-types, lint, web vitest (**544** tests / 73 files),
  build, knip.
