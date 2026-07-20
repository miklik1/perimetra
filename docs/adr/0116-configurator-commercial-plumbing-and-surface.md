# ADR 0116 — The configurator's commercial plumbing, and the surface built on it

**Status:** Accepted (2026-07-20 — decided by Martin during the ADR 0114 Phase 1b
configurator slice). Implements the `/configurator` surface against
`design/configurator/frames-v2.jsx`, and records the contract changes that turned
out to be prerequisites for it. Builds on [ADR 0115](0115-release-authored-wizard-steps.md)
(the step model) and [ADR 0114](0114-design-canvas-adoption.md) (the design
authority). Does not supersede either.

## Context

`design/README.md` §11.1 sequences the Konfigurátor first, and the ADR 0114 kit
floor plus the ADR 0115 step model left the surface itself as the remaining work.
The expectation was a reskin: compose the shipped kit into the five frames the
canvas draws.

Two of those frames turned out not to be a reskin.

**The commercial panel had no data behind it.** `frames-v2.jsx` draws purchase
cost, a real margin percentage and a margin-floor meter. All three were being
discarded before they reached the engine, in three places at once:
`catalog-bundle.ts` parsed the whole `priceTableSchema` — which carries `cost`,
`marginFloorPct`, `dphRate` and `roundingPolicy` — and kept `table` alone;
`CatalogBundle.prices` was typed `PriceTable | null`; and `deriveForUi` called
`deriveInstanceDetailed` with no `options`, so `result.costTotals` and
`result.costMoney` were structurally always `undefined`. No margin was renderable
because no cost had ever been computed.

**And the same omission carried a live correctness defect.** `DeriveOptions.rounding`
threads the org's commercial rounding policy (ADR 0081) into the money boundary.
`quotes.service.ts` passes `priceTable.roundingPolicy` when it derives at `issue`
and again at `verify`. `deriveForUi` passed nothing, so the client derive silently
fell back to `DEFAULT_ROUNDING_POLICY` — **the price a rep read off the
configurator could differ from the price the quote froze.** The site canvas
(`app/site/derive.ts`) had the identical gap. This is not a design problem and it
predates this wave; it surfaced only because the reskin needed the price table's
other columns and went looking for them.

## Decision

### 1. Pricing travels as one object, and the rounding policy is not optional

`CatalogBundle.prices: PriceTable | null` becomes
`CatalogBundle.pricing: ConfiguratorPricing | null`:

```ts
interface ConfiguratorPricing {
  table: PriceTable;
  cost: CostTable | null;
  marginFloorPct: number | null; // percent, 0–100 — the server guard's units
  rounding: RoundingPolicy;
}
```

`deriveForUi` and `SiteDeriveContext` take this instead of a bare `PriceTable`,
and both thread `costs` + `rounding` into every `deriveInstanceDetailed` /
`deriveSite` call.

Two deliberate choices inside that. The field is **renamed** `prices` → `pricing`
rather than widened in place, so every call site becomes a compile error that a
human reads, instead of a shape that quietly still destructures. And `rounding`
is **required, not optional**: the engine defaults a missing policy, which is
exactly how the defect above stayed invisible. Making it part of what a price
_is_ means the lab and the tests must state a policy too — `scene-lab-client.tsx`
and `golden-bundle.ts` now pin `DEFAULT_ROUNDING_POLICY` explicitly, which is
also what keeps the golden totals (gate 81 451.504, site 134 723.5) meaningful.

I3 is untouched. Nothing here changes what a quote freezes or how it re-derives —
the server was always correct. What changes is that the client now agrees with it.

### 2. The derive moves off the main thread

`design/README.md` §7.6 forbids running the derive on the main thread: it re-runs
per keystroke today and per animation frame once direct manipulation lands, where
it would compete with the frames it exists to feed. The ADR 0114 Phase 1b
foundation already generalised the release editor's worker transport into
`apps/web/lib/engine-worker/`; this slice adds the configurator's consumer —
`configurator-engine.ts` (pure, worker-agnostic), a thin `.worker.ts` pump, and
`useConfiguratorDerive`. Same seam as the release editor: monotonic id with
last-write-wins, context cached worker-side, 150 ms keystroke debounce, and a
synchronous fallback when no `Worker` can be constructed.

Two guards protect one failure mode. The context-caching effects are **declared
before** the request effect, so a render that changes both context and input
posts the new context first; inverting them derives new input against the
previous price table, which returns success carrying a wrong number. Independently,
the worker returns `no-context` rather than deriving against a partially
populated cache. Both exist because the consequence is a plausible wrong price
rather than a visible failure, and no happy-path test would catch it.

### 3. Cost and margin are admin-only — a narrower line than price-blindness

`usePriceBlind` (ADR 0056) is the money / no-money line: admin and sales see the
sell price, workshop sees none. Purchase cost and the margin it implies are a
narrower class, and get their own hook, `useCanSeeCost()` — `admin` only.

A rep quoting in front of a customer does not need the purchase price on screen,
and the margin floor is enforced server-side at `issue` regardless of what the
client renders. The accepted cost is that a sales user meets a floor breach as a
422 at issue rather than as a live meter.

**This is screen hygiene, not a security boundary.** The API ships cost to any
non-workshop session, so a determined sales user could read it off the wire. A
future surface must not treat this hook as an authorisation gate.

### 4. What the surface deliberately does not build

Four things the canvas draws are absent, each because building them would mean
shipping a control that leads nowhere — the same rule `design/README.md` §5
applies to the `fakturováno` badge.

- **The context bar's quote number, project name, save state, back link and
  _Náhled nabídky_.** Standalone `/configurator` is not bound to a project or a
  quote; that data does not exist. The bar degrades to what is true — product,
  catalog version, and a computing indicator. Project binding belongs to the
  phase that owns the quotes hinge.
- **_Povolit odchylku_.** There is no deviation-ledger backend. The breach state
  ships (it is real, and derived); the action does not. The copy states the
  consequence instead: _"Vydání nabídky bude vyžadovat schválení odchylky."_
- **The _Vytvořit nabídku_ / _Uložit do projektu_ CTAs in the commercial panel.**
  Saving already exists, as `SaveToProjectPanel` on the Souhrn step, with real
  project-picking UI. Duplicating it as a bare button in the price panel would
  either dead-end or hide a multi-step flow behind one control. The panel is
  information-only.
- **The `locked` step state and its _V1_ badge.** No data model carries it.
  §8.3 settles that _Připravujeme_ is vendor publish metadata and _Skryto_ is a
  tenant visibility flag — two different mechanisms at two tiers, neither
  surfaced yet. `RailItem` therefore has no `locked` field.

### 5. The Rozpad / BOM view

The canvas draws this tab in every frame and the export contains no render branch
for it — layout, grouping, columns and price visibility were all undefined.
Decided: a grouped part table, grouped by `part.category` into the same four
buckets the totals use, in fixed order, with per-group subtotals and a grand
total. Money columns are **absent** — not blanked, not masked — when the viewer
is price-blind, per ADR 0056.

It reuses the quote's BOM vocabulary deliberately, so the phase that builds the
quotes detail inherits the language rather than inventing a second one.

### 6. The responsive bands, and where they break

Three bands, one layout: `< md` phone (scene on top, form as a bottom sheet,
`StepProgress` dots), `md–xl` tablet (horizontal step chips, narrowed form
column, commerce in a sticky bottom bar), `xl+` desktop (210px vertical rail,
400px form column, scene fills the rest).

**Desktop starts at `xl` (1280), not `lg` (1024).** The canvas's "tablet on-site"
frame is 1194 × 834 and its desktop frames are 1440, so a `lg` boundary put the
on-site tablet target into the desktop layout — the exact width §12.1 names for
the tablet band. Caught by the eyes-on pass, not by any test.

Three more defects the eyes-on pass caught that the green gate did not, recorded
because each is a class that will recur:

- **The step heading used `DisplayLabel`**, whose base is
  `text-4xl sm:text-6xl md:text-display`. An override of `sm:text-3xl` cannot
  beat the `md:` rule, so from 768 up the heading rendered at hero display size,
  overflowed the 400px column and clipped the step counter beside it. It is now
  a plain heading; `DisplayLabel` is hero type and a step heading is not a hero.
- **The root was `h-dvh`** while `nav-shell.tsx` renders an in-flow `h-14` app
  header above it, so the surface was 56px taller than its slot and pushed the
  sticky commerce bar off the bottom of the screen at every width. Now
  `h-[calc(100dvh-3.5rem)]`, coupled to that `h-14` by a comment on both sides.
- **`w-max` on the chip row collapsed it.** `StepNav`'s root carries
  `@container/step-nav` (`container-type: inline-size`), and such a container
  sizes from its own content — so `w-max` measured ~32px, the `@[10rem]` query
  never matched, and every chip rendered as a bare numbered dot with its label in
  `sr-only`. Tests stayed green because the accessible name survives; only
  sighted users lost the step names, at the touch-first band.

The kit's `StepNav` collapse threshold was itself wrong — `@[18rem]` (288px)
measured against a content box of ~186px inside the 210px rail its own doc
comment specifies, so the expanded state was structurally unreachable. Lowered
to `@[10rem]`.

## Consequences

- The configurator's price now equals the price `issue` freezes. Any surface that
  derives client-side must construct a `ConfiguratorPricing`; there is no longer
  a way to derive without stating a rounding policy.
- `apps/web/lib/margin.ts` duplicates `apps/api/src/modules/quotes/margin.ts` by
  hand, including its degenerate branch. They must stay in lockstep — the same
  precedent as the `OrgRole` tuple and `org-access.ts` ↔ `permissions.ts`
  (ADR 0057). A divergence means a rep is told a configuration clears the floor
  and then gets a 422.
- The site canvas gained the rounding fix but no reskin. `design/README.md` §5
  fences its contents out of this wave; correcting a wrong number is not a reskin
  and was not deferred with the rest.
- The unguarded `RAL[ral].hex` lookup that §8.2 flags as a crash is in the design
  export's `parts.jsx` only. The shipped app has a nine-entry finish registry with
  a guarded `finishById` fallback (`scene/finish.ts`), so there was nothing to
  fix — the canvas bug must simply not be ported. Recorded because the gap list
  reads as if the app were affected.
- The immersive frame (`v2-IMM`) and the §7.6 direct-manipulation loop — in-scene
  picking, corner handles, dimension-pill editing, the six-tool dock — are **not**
  in this slice. They are a real-time interaction editor rather than a layout, and
  they depend on the worker transport this slice lands. They follow immediately,
  as their own commit.
- The eyes-on harness is `apps/web/scripts/verify/capture-configurator.mjs` (six
  widths × both themes, plus a horizontal-body-scroll assertion at each). Two
  traps are baked into it as comments: `waitUntil: "networkidle"` never settles
  against the dev server's HMR socket, and the context bar keeps an `aria-hidden`
  ghost copy of the "recalculating" string mounted permanently to reserve its
  layout slot — so waiting for that string to DISAPPEAR can never succeed. It
  waits for a rendered price instead.
- `/configurator` logs a hydration mismatch in dev. It is **pre-existing and not
  introduced here**: `AuthGuard` renders its `fallback` on the server and the
  authenticated tree on the client, so the two never match. This slice only made
  the diff louder by changing the root element's classes. Fixing it means
  changing `AuthGuard`'s SSR story across every surface that uses it, which is
  its own decision.

### Known and deliberately not fixed

Each of these is real, none blocks the slice, and all were found by the
adversarial review or the eyes-on pass rather than assumed:

- **`StepNav` dot ordinals go stale when the step count changes.** The ordinal is
  measured by a ref callback that re-runs only on node mount, and the three shell
  steps keep stable keys across a product switch — so a release authoring 3 steps
  followed by one authoring 1 leaves the rail reading `1, 2, 5, 6` in a four-step
  wizard, beside a counter correctly reading `n/4`. Not reachable with the two
  shipped fixtures; reachable from vendor-authored release data alone.
- **`SegmentedNav` is hardcoded as page navigation** — it renders a `<nav>`
  landmark and stamps `aria-current="page"`. For the scene's view switch both are
  wrong ("Rozpad, current page" for a control that changes no page), so
  `scene-column.tsx` re-states the semantics from app-land through props. That
  override will drift; the kit wants a non-navigation variant.
- **`Spinner` hardcodes a Czech `aria-label="Načítání"`** in `@repo/ui`, so every
  consumer inherits an untranslatable string. Neutralised locally in the context
  bar; unfixed at the kit.
- **`FadeScrollArea` is vertical-only**, so the horizontally-scrolling chip row
  ships without the masked-edge fade §8.1 codifies. §8.1 forbids re-implementing
  the gradient locally, so the cue is simply absent until the kit gains an
  orientation.
- **`flex-col-reverse` on the phone band** inverts visual order against DOM
  order: the form is first in the DOM (good for tab order and for the desktop
  band) but painted below the scene. A WCAG 1.3.2/2.4.3 judgement call rather
  than a clear defect, left as-is and recorded.
- **`Part.pricePerUnit`/`totalPrice` remain raw floats** on the engine type, with
  no rounded mirror (unlike `SiteBomLine.totalPriceMoney`). The BOM table rounds
  at the display boundary; the structural fix belongs in `@repo/engine`.
