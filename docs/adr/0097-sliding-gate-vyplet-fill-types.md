# ADR 0097 — Complete the seven cantilever Výplet fill types + a second Excel anchor

**Status:** Accepted (2026-06-29 — core-hardening slice 3, after slice 1's
geometry fix (ADR 0095) and slice 2's relight (ADR 0096)). **Implementation:**
fixtures/catalog DATA only — `packages/fixtures/src/releases/sliding-gate.ts`
(the `fill` option set: 2 → 7 options), `packages/fixtures/src/catalog/catalog-v1.ts`
(two fill sections + four alu/steel components; flows into catalog@2 via its
spread), `packages/fixtures/src/golden/sliding-gate.ts` (one new Excel anchor +
five per-type regression cases), `packages/fixtures/src/golden/site.ts` (the live
price + demo-cost tables, so the configurator can price every type). **NO
`model`/`engine`/`renderers`/web change — I1–I11 untouched; every pre-existing
golden reproduces UNCHANGED (`81451.5`, `75174.2`, `73741.5`, site `129891.5` /
`79039.86`); no re-baseline.** Verified: full gate green + api integration 134/134;
each new golden total derived by the engine, not hand-computed.

## Context

The core-hardening review (`wf_f4a764a5-84e`) found the cantilever calculator
~62 % complete for daily use: only **2 of the 7** Výplet (infill) fill types were
authored (`planka_100_2d`, `lamela_113_3d`), and the live site price table didn't
even carry a `lamela_113` price — selecting the one non-planka type already shipped
would have produced an I5 missing-price error. Only one of the workbook's example
calculations (`81451.504`, planka 100 2D at 4.0 m) was regression-locked.

Two independent ground truths define the seven types and agree **cell-for-cell**:

- the 2026 Excel `Výplet` sheet
  (`~/gates/reference_files_unlocked/2026-PC_Samonosna_brana_FINAL_PC-do 4,5m.xlsx`),
  columns: min. vzd. od konce 1/2, min./max. rozteč, max. překrytí, Vypnout max?,
  cena/m;
- the working gates-MVP `fillType` seed (`packages/db/src/seed.ts`).

The seven: LAMELA 113 3D, LAMELA 120 3D, PLAŇKA 120 3D, LAMELA 113 2D, PLAŇKA 120
2D, PLAŇKA 100 3D, PLAŇKA 100 2D. (JAKL 20/20 is the eighth seed row but is
deliberately deferred — it uses a manual fill count + a distinct tube-spacing
branch, not the unified `floor((postA−115)/min_spacing)` path.)

## Decision

**Author all seven fill types as release option data, transcribed from the Excel
`Výplet` sheet**, and widen the golden corpus + the live price tables to match.

1. **Seven `fill` options**, each carrying the full Výplet record: `profile_mm`,
   `dimension_type`, `min_spacing_mm`, `section_code`, plus the placement attrs
   `end_offset_1_mm`, `end_offset_2_mm`, `max_spacing_mm`, `max_overlap_mm`,
   `disable_max_spacing`. `min_spacing_mm` drives the (already-correct) unified
   count; `dimension_type` drives the 2-panel rail multiplier (3D ⇒ 1.4, 2D ⇒
   1.333). The placement attrs are authored NOW for data completeness but stay
   **inert** until the real Výplet spacing engine (next slice) consumes them —
   today the geometry still stacks at `min_spacing_mm` pitch (approximate).

2. **One catalog component per physical profile.** The Excel shows an identical
   `cena/m` for the 2D and 3D variant of each profile, and they are the same
   extrusion, so `lamela_113`/`planka_100` each serve both their 2D and 3D option,
   and two new sections + components (`lamela_120`, `planka_120`, alu + steel) cover
   the rest. Collapsing the gates-MVP seed's redundant `planka_120_3d`/`_2d` codes
   into one `planka_120` is the more correct model and avoids an ambiguous
   `{role:fill, section, material}` resolution. (`validateRelease` passes
   unchanged: `fill.section_code` is parameter-driven, so resolution is checked at
   derive time, not statically.)

3. **A second genuine Excel anchor.** `lamela_113_3d_5m` locks the
   `…do 5m-výroba.xlsx` U34 = **83 522.442** (LAMELA 113 3D, 4.5 m, 3-panel) — the
   engine reproduces it byte-for-byte; money rounds to haléř (ADR 0081) →
   `83522.44`. Plus **five per-type regression cases** (the 4.0 m base config,
   fill type varied) so every new option is proven to resolve + price; their
   expected totals are what the engine derives.

4. **Backfill the live price/cost tables** (`golden/site.ts`, which the api seed
   imports) with the four fill sell prices from the Excel H-column so the live
   configurator prices all seven, plus demo buy-costs at planka_100's ratio.

## The third workbook is NOT an anchor (a real finding)

The `…do 4,5m - výroba.xlsx` example (U34 = **81 849.192**, the value loosely cited
as a golden in ADRs 0095/0096 — it was never actually locked in code) is **not**
delta-0 reproducible and is deliberately not locked. Its rail-length formula is
`=Q4*1.334`, a hand-typed VZOR-sample typo: the canonical multiplier is **1.333**,
used by both the kalkulace sheet and the 5 m sheet, by the gates-MVP engine, and by
perimetra. The engine's 1.333 (→ 81 847.704 for that config) is correct; the sample
sheet is wrong by ~1.49 CZK on two rail-derived accessory lines. This is exactly the
fidelity gap eyes-on ground truth surfaces — the generic engine is _more_ consistent
than the hand-filled sample workbook.

## Consequences

- All seven cantilever fill types are now configurable, resolve through the
  catalog, and price live. Daily-usability gap (lamela had no live price) closed.
- Golden coverage: 1 → 2 real Excel anchors + 5 regression cases (9 total).
- The placement attrs are dead data until the next slice wires the real spacing
  algorithm (end offsets / max-overlap / disable-max), which will also be the
  point at which the new types' RENDER is eyes-on verified (slice 3 changes no
  geometry template — the new types reuse the planka/lamela template proven in
  slices 1–2 — so it makes no geometry-correctness claim).

## Flags for Martin (data/decisions, not blockers)

- **Demo fill costs** (`lamela_113` 135, `lamela_120`/`planka_120` 170) are
  placeholders at planka_100's ~0.62 sell ratio — replace with real supplier costs
  in the FIL/price slice. (Sell prices ARE real, from the 2026 Excel.)
- **The 1.334 typo** in the 4.5 m výroba sample sheet (above) — worth telling FIL;
  no code action.
- The earlier-flagged items stand (catch-post height 1900, the box-fallback
  profiles, the Excel mitre cut angles 55/17,5) — owned by their own gated slices.
