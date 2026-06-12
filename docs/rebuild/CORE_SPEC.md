# Perimetra Core Schema Spec (Enterprise Rebuild)

_v0.1 — 2026-06-11. The founding document of the new monorepo. Everything here is the
conceptual contract; storage details (tables vs. JSONB) are implementation choices as long as
the invariants hold. Validation basis: `docs/audits/2026-06-04-cpq-industry-research.md` and
`docs/audits/2026-06-10-enterprise-rebuild-validation.md`._

## 0. The one-paragraph architecture

Perimetra is a vertical CPQ where **product knowledge is data, not code**. A single generic
engine interprets immutable, versioned **Product Model Releases** authored exclusively by the
vendor (never by tenants). A configured product is an **Assembly Graph**; a project is a
**Site Graph** of positioned, connected assemblies. Every value resolves through an **override
cascade** (release → catalog → tenant → customer agreement → quote), every deviation lands in
an **exception ledger**, and every output (BOM, price, cut list, 3D, 2D) derives from the one
assembly/site graph. Quotes stamp every version and override they were computed under and are
reproducible forever.

```
┌────────────────────────── authored by vendor (data) ─────────────────────────┐
│  Catalog (materials, sections, components)   Product Model Releases (vN)     │
└──────────────────────────────────┬────────────────────────────────────────────┘
                                   ▼
        Resolution cascade:  release → catalog → tenant → customer → quote
                                   ▼
   ┌── Engine (generic interpreter: params → constraints → derivation) ──┐
   │                  produces ASSEMBLY GRAPH per instance               │
   │            instances + terrain + connections = SITE GRAPH           │
   └───────┬───────────┬───────────┬───────────┬───────────┬─────────────┘
           ▼           ▼           ▼           ▼           ▼
          BOM        Price      Cut list    3D scene   2D drawings
           └───────────┴─────── snapshot on Quote ──────────┴──────┘
```

## 1. Non-negotiable invariants

These are the definition of "bulletproof". Every PR is judged against them; CI enforces what
can be enforced mechanically.

- **I1 Determinism.** Same (config + release version + catalog version + cascade state) →
  byte-identical outputs. No clock, no randomness, no I/O inside the engine.
- **I2 Delta-0 continuity.** Every release ships with golden fixtures. The first releases must
  reproduce the MVP's Excel-derived fixtures exactly. A release without passing fixtures
  cannot be published.
- **I3 Eternal reproducibility.** Any historical quote can be re-derived from its stamps
  (release ids + catalog version + price table version + override set) and must reproduce the
  snapshot. Releases and catalog versions are therefore immutable and never deleted.
- **I4 Single geometric truth.** BOM quantities, cut lengths, 3D scene, 2D drawings, and any
  future CAM output derive from the assembly/site graph. No renderer ever re-computes
  geometry from raw config.
- **I5 No silent zeros.** Unresolvable component, missing price, failed constraint → typed,
  surfaced error. Never default to 0, never skip a line.
- **I6 Shared elements counted once.** An element shared between connected instances (the post
  between two fence fields) has exactly one owner in the site graph; BOM/price/cut-list
  aggregation deduplicates by ownership, structurally.
- **I7 Tenants cannot break models.** Every value carries an adjustability class; the schema —
  not UI convention — makes vendor-only values unwritable through tenant surfaces.
- **I8 Overrides layer, never mutate.** No layer's data is ever edited by a higher layer; an
  override is a new record with provenance. Removing an override restores the layer below.
- **I9 Stable addressing.** Every derived artifact (a part, a BOM line, a cut, a drawing
  dimension) has an id that is stable across re-derivations of the same config, so overrides
  and annotations survive recomputation. Ids derive from the recipe path, never from array
  position alone.
- **I10 Units.** Lengths are integer **mm**. Angles are integer **arc-minutes** or decimal
  degrees as strings. Money is **decimal-as-string** with currency, never floats. Quantities
  are rationals (numerator/denominator) where division occurs.
- **I11 Multi-instance native.** Nothing in the schema assumes one product config per
  project/quote. A single gate is a site with one instance — the degenerate case, not the
  model.

## 2. Layer A — Catalog (data with physics)

The catalog is global, vendor-authored, and **versioned as immutable releases** (`catalog@N`).
Tenant-specific additions live as tenant-layer records referencing the global catalog, not
copies of it (this is the shared-catalog-with-overrides fix; clone-on-approve is dead).

```ts
Material {
  id, code              // "alu", "steel", "oak", "glass_tempered"
  class                 // metal | wood | glass | composite
  density_g_cm3         // physics; real data only — never invented (FIL/supplier-sourced)
  kerfClass             // links to fabrication-profile kerf defaults
  finishes[]            // e.g. RAL powder-coat, anodize, oil, none
  joiningMethods[]      // weld | screw | clamp | glue — feeds connection validation
}

SectionProfile {
  id, code              // "L50x50", "jakl_30x30", "glass_pane_8"
  shape                 // L | U | T | rect_tube | flat | pane | custom(svgPath)
  w_mm, d_mm, wall_mm
  materials[]           // which materials this section exists in
}

Component {
  id, code              // purchasable/cuttable unit: "post_L50_alu"
  name, unit            // piece | meter | m2 | kg | hour
  roles[]               // semantic roles: "post.vertical", "rail.top", "fill.lamela", "hinge"
  materialId?, sectionId?
  stockLength_mm?       // for nesting
  attrs {}              // typed extras (e.g. lamela width 113)
}
```

**Role-based resolution** is the multi-material mechanism: derivation recipes request
`{role, section?, material}` and the engine resolves a Component. The same sliding-gate model
yields aluminum or oak by switching the material parameter — the recipe never names a
component code directly. Resolution failure is an I5 hard error listing the missing
(role, section, material) triple, which doubles as the vendor's "what to add to the catalog"
worklist.

## 3. Layer B — Product Model Release

A `ProductModel` is a family ("sliding gate"). A `ProductModelRelease` is an immutable
published version of its full definition. **Authoring is vendor-only, permanently** (the
research-validated boundary). Tenants are _assigned_ releases and pin to them; upgrades are
explicit opt-in per tenant.

```ts
ProductModelRelease {
  id, modelId, version            // "sliding-gate@4"
  status                          // draft | published | retired (published = frozen)
  parameters: ParameterDef[]
  constraints: ConstraintDef[]
  derivation: DerivationRecipe
  ports: PortDef[]
  ui: UiSpec
  fixtures: GoldenFixture[]       // I2: publishing requires green fixtures
}

ParameterDef {
  key, type                       // length_mm | int | select | multiselect | bool | color | text
  domain                          // {min,max,step} | enum refs | pattern
  default: Expr | literal
  adjustability                   // vendor | tenant | user        (I7)
  deviation: {                    // the "but not there" knowledge — extracted from FIL
    mode: free | warn | hard      // freely overridable / needs reason+warning / engineering limit
    bounds?: {min: Expr, max: Expr}
    note?                         // why the limit exists ("diagonal below X sags")
  }
  relevance?: Expr                // UI shows param only when true (generated-UI relevance)
}
```

**Expressions** are a small, deterministic, serializable DSL (stored as strings, parsed and
evaluated by the engine): arithmetic, comparisons, `min/max/roundUp/roundTo/clamp/if`,
references to parameters, derived values, and catalog attributes. No loops, no time, no
randomness (I1). This DSL is the _entire_ programmability surface of a product model — if a
model needs more, the engine grows a whitelisted function, never the model an escape hatch.

**Constraints are declarative records**, evaluated by a forward checker today:

```ts
ConstraintDef {
  key                             // doubles as the i18n message key (validator-keys rule carries over)
  kind: range | requires | excludes | expr
  expr: Expr                      // must evaluate true
  severity: error | warn
  scope: instance | connection    // connection-scope = inter-instance (site) constraints
}
```

The evaluator is a swappable module behind a narrow interface (`evaluate(release, config,
siteCtx) → Issue[]`). If option-interaction complexity ever crosses the solver triggers from
the 2026-06-04 research, a CSP evaluator replaces the checker and **every authored model comes
along unchanged**. The schema is the commitment; the evaluator is an implementation detail.

**DerivationRecipe** — config → assembly, the heart of the engine:

```ts
DerivationRecipe {
  derived: {key: Expr}[]          // named dimensions (postA, railLength, fillCount, …)
  parts: PartRule[]               // each generates 1..n Parts
  joints: JointRule[]
}

PartRule {
  path                            // stable id root, e.g. "frame.post[left]"  (I9)
  role, material: Expr, section?  // catalog resolution request (§2)
  repeat?: {count: Expr, var}     // arrays: "fill[i] for i in fillCount"
  geometry: {length: Expr, cuts: {angleL: Expr, angleR: Expr}, transform: Expr[]}
  bom: {unit, quantity: Expr, category}   // material | accessory | manufacturing | installation
}

PortDef {
  id, kind                        // "fence.end", "gate.hinge-side", "post.top"
  compatibleKinds[]
  anchor                          // position on the assembly (expr-driven)
  sharing?: {element: partPath, policy: owner|consumer}   // I6: shared-post declaration
}
```

Manufacturing hours remain an explicit, estimator-editable parameter (`adjustability: tenant`)
seeded by a formula default — the MVP's Výroba rule carries over.

## 4. Layer C — Resolution cascade & exception ledger

Any addressable value — parameter default, price, option availability, even a derived artifact
(§6) — resolves bottom-up through five layers. CSS mental model: most specific wins, full
provenance retained.

```
1 release      what the product IS (vendor)
2 catalog      physics & components (vendor, global)
3 tenant       FIL's deltas: prices, defaults, disabled options, colors, hours
4 customer     standing agreements: "this client always gets X" (price or config)
5 quote        this-order-only exceptions, incl. mm deviations and artifact overrides
```

```ts
Override {
  id, scope: tenant | customer | quote
  scopeRef                        // tenantId / customerAgreementId / quoteId
  target                          // stable address: "param:opening_width" | "price:post_L50_alu"
                                  //               | "artifact:frame.post[left].cutLength"
  value
  author, reason, createdAt       // provenance (I8); reason required for deviation.mode=warn
  pricingResolution?              // explicit price consequence chosen by sales (margin floor guards)
}
```

Writing an override is validated against the target's `adjustability` (I7) and `deviation`
(hard bounds reject; warn requires reason). The **exception ledger** is simply the queryable
set of all scope-5 overrides. A recurrence report (same target ± similar value across N quotes
or M customers) feeds the vendor's authoring queue: recurring deviations get **promoted** into
the next release as real parameters/options — the validated ETO→CTO flow. The ledger needs an
owner; promotion is a human decision, never automatic.

## 5. Layer D — Instance, Site, and the graph

```ts
ProductInstance {
  id, releaseId                   // pinned, exact version
  config {paramKey: value}        // post-cascade input values
  // assembly graph is DERIVED (cacheable), never hand-stored
}

Site {
  id, projectId
  boundary?: Polyline_mm          // optional; future: imported from ČÚZK cadastre by parcel no.
  terrain: Segment[]              // per-segment ground elevation deltas (v1: stepped, not mesh)
  placements: {instanceId, pose: {origin_mm, rotation}}[]
  connections: {a: {instanceId, portId}, b: {instanceId, portId},
                resolvedSharing?: {ownerInstanceId, partPath}}[]   // I6
}
```

Connection rules: ports connect only when `kind` is compatible; `scope: connection`
constraints then evaluate across the pair (height continuity, joining-method compatibility via
material `joiningMethods`). "One plot higher, one lower" = terrain segments driving each
instance's elevation parameter; the connection constraint decides whether the step is stepped,
raked, or invalid per the model's rules.

**Derivation pipeline** (the only compute path, I4):

```
resolve cascade → validate constraints (instance + connection scopes)
  → derive each instance's AssemblyGraph → compose SiteGraph (apply sharing/ownership)
  → emit: BOM (aggregate, dedupe by owner)        →  price (price table + rates + margin floor)
          CutList (nest per fabrication profile: kerf, stock lengths)
          Scene3D  /  Drawing2D (site plan + per-instance workshop views)
```

## 6. Layer E — Outputs, artifact overrides, and the quote

Every emitted artifact carries its stable address (I9). **Artifact-level overrides** are the
deep half of the mm-exception requirement: not just inputs, but a specific BOM quantity, cut
length, or drawing dimension can be overridden at quote scope ("make that one cut 1942") —
with provenance, an explicit pricing resolution, and a mandatory deviation flag rendered on
the workshop drawing. The salesperson is never blocked; the workshop always sees what
deviated; the system is never silently wrong.

```ts
Quote {
  id, projectId, tenantId, shareToken, validUntil, status
  stamps {                        // I3 — full reproducibility, not just frozen numbers
    releaseIds: {instanceId: releaseId}[]
    catalogVersion, priceTableVersion
    overrideIds[]                 // the exact cascade state applied
  }
  snapshot {bom, totals, cutList, drawings, inputs}   // frozen outputs (MVP pattern, kept)
}
```

Commercial guardrails carried from research: per-tenant price tables with effective-date
windows (no yearly clones), margin floor as the single lightweight approval mechanism (no
approval-chain machinery), CZK/EUR with DPH/reverse-charge correctness.

## 7. Tenancy & roles (carried forward, hardened)

Unchanged in concept from the MVP, restated as rebuild requirements: every row tenant-scoped;
explicit tenant guards at the query layer (+ RLS as defense-in-depth where the platform
allows); roles admin/sales/workshop with workshop price-blind; append-only audit on all
catalog/price/override mutations (widened from the MVP's status-only history). Tenant kind
`template` disappears — templates are replaced by release pinning (§3).

## 8. What tenants see (the product surface)

The platform is invisible (research condition). Tenants get an opinionated vertical product:

- **Configure**: per-instance forms _generated_ from `UiSpec` + parameter `relevance` — steps,
  groups, and visibility come from the model, so a new product family ships with a working
  wizard. The site canvas (place, connect, drag instances; 3D playground) is the same
  generated surface at site scope.
- **Adjust safely**: admin edits exactly the `adjustability: tenant` set — prices, defaults,
  colors, hours, option toggles. The boundary FIL guesses at in Excel becomes schema (I7).
- **Deviate**: scope-5 overrides through the configurator with the deviation UX (§4, §6).
- **Never**: author models, edit recipes, see expressions.

## 9. Monorepo mapping (suggested package cut)

```
packages/model      schema + types + Expr DSL parser (zero deps, the published contract)
packages/engine     interpreter: cascade, constraints (swappable evaluator), derivation  [pure]
packages/catalog    catalog types + resolution
packages/renderers  scene3d / drawing2d / cutlist / pdf — consume SiteGraph only (I4)
packages/db         persistence of all of the above + tenancy
apps/web            generated configurator, site canvas, admin, quotes, leads
fixtures/           golden fixtures incl. the ported MVP Excel-parity corpus (I2)
```

`model` + `engine` stay pure (no I/O — the MVP calc-engine discipline, widened to the whole
core). Authoring tooling (vendor-internal model editor, fixture runner, ledger recurrence
report) can start as repo scripts; it productizes only for _us_, never for tenants.

## 10. Build order

1. **`model` + `engine` core**: Expr DSL, parameters, constraints, derivation → assembly graph
   for ONE product (sliding gate), validated delta-0 against ported MVP fixtures. _Proves I1/I2._
2. **Catalog + role resolution + second material** on the same model. _Proves multi-material._
3. **Cascade + overrides + ledger** (input-level first, artifact-level second). _Proves the
   FIL exception story._
4. **Site graph**: two fence runs + gate, shared posts, stepped terrain, connection
   constraints; aggregate BOM. _Proves I6/I11._
5. **Renderers** off the site graph (3D, 2D, cut list, PDF). _Proves I4._
6. **App surfaces**: generated configurator + site canvas + admin + quote lifecycle (port MVP
   patterns: snapshots, price tables, tenancy, roles).
7. Remaining product families as **authoring exercises** — each one a measurement of
   modeling-hours-per-product, the business-model hinge the research flagged.

Deferred unchanged: DXF/CAM (demand-gated on fabrication profile), solver evaluator
(trigger-gated), cadastre import and free 3D terrain (features on the site model), AI layers
(never touching price/BOM).

## 11. Metrics that decide the business model

Track from the first authored model: (a) vendor hours to author + fixture a new product
family; (b) hours to add a material to an existing family; (c) ledger promotion rate
(exceptions → options per release). (a) and (b) are the unbenchmarked hinge of
modeling-as-a-service economics; (c) measures whether the ledger is doing its job.
