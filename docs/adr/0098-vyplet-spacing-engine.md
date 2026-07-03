# ADR 0098 — Výplet spacing engine (Excel `Kalkulace` slat placement)

**Status:** **Proposed** (2026-07-03 — documents the as-built spacing engine that
shipped uncommitted-then-checkpointed in `83ffc65`; the three in-code `ADR 0098`
citations in `packages/fixtures/src/releases/sliding-gate.ts` refer here). **NOT
Accepted, NOT golden-locked** — deliberately: the 2026-07-02 model-truth review
([[Decision — sliding-gate model-truth wave]] / Linear CAR-18/25) re-derives the
entire sliding-gate assembly (member inventory + placement) from FIL's 2026 Excel,
and the slat-spacing math is inside that scope. Locking a spacing golden now would
force a rebaseline the moment the re-authored model lands. This ADR records what is
IN the tree so the citations resolve and the decision is reconstructable; it flips
to Accepted (with the per-fill regression lock + captures) only after Martin's
eyes-on pick of the re-derived model.

## Context

Through ADR 0097 the seven Výplet fill types were authored as release data, but the
placement attrs (`end_offset_1_mm`, `end_offset_2_mm`, `max_spacing_mm`,
`disable_max_spacing`, `max_overlap_mm`) were **inert** — the geometry still stacked
slats at a fixed `min_spacing_mm` pitch (an approximation ADR 0097 flagged as "until
the real Výplet spacing engine, next slice"). The Excel `Kalkulace`/`Výplet` sheets
compute slat placement differently: a raw pitch spread over the clear span minus the
two end offsets, capped at a per-fill max unless the fill disables the cap (the
tight-overlap 3D lamellas), with the leftover remainder re-centred so the two end
gaps differ by ≤1 mm.

The slat **count** formula is unchanged (ADR 0097's unified
`floor((postA − 115) / min_spacing)` path), so **BOM and price are structurally
untouched** — every pre-existing golden reproduces byte-identically
(`81451.5`, `129891.5`, `79039.86`, …). This ADR changes only where the slats
**sit** (presentation off the same derivation, I4).

## Decision (as-built)

Consume the ADR-0097 placement attrs in five derived keys on the sliding-gate
release, feeding the fill piece's `at.y`:

| Key             | Expr (Excel `Kalkulace`)                                                              |
| --------------- | ------------------------------------------------------------------------------------- |
| `fillGaps`      | `max(fillCount - 1, 1)`                                                               |
| `fillRawPitch`  | `floor((hProfileLength - fill.end_offset_1_mm - fill.end_offset_2_mm) / fillGaps)`    |
| `fillPitch`     | `if(fill.disable_max_spacing, fillRawPitch, min(fillRawPitch, fill.max_spacing_mm))`  |
| `fillRemainder` | `hProfileLength - fillGaps * fillPitch - fill.end_offset_1_mm - fill.end_offset_2_mm` |
| `fillOffset1`   | `fill.end_offset_1_mm + roundUp(fillRemainder / 2)`                                   |

Slat `i` centre: `ground_elevation_mm + 90 + fillOffset1 + (i % fillCount) * fillPitch`
(was `+ 130 + i * min_spacing`). `roundUp` is a new Expr fn (ceil for the
remainder-halving so `offset1 ≥ offset2`).

**Overlap guard** (`sliding.fill.overlap_within_max`, severity `warn`): an
attr-only I2 data check `fill.profile_mm - fill.min_spacing_mm <= fill.max_overlap_mm`
(Excel `max. překrytí`). It is deliberately a conservative min-pitch bound evaluated
**pre-derivation** (instance constraints run before the derived keys exist), not a
pitch-aware post-derivation overlap check — the honest limitation is recorded so the
re-author can decide whether the real check belongs in the derivation phase.

## Consequences

- **Open until the model-truth pick.** The count formula, BOM and price are frozen;
  the spacing math is retained but **unverified** (zero regression coverage today —
  the ADR-0095 geometry envelope golden is deliberately envelope-based and survives
  it). The per-fill regression lock (fillPitch/fillOffset1 vs hand-computed Excel
  `Kalkulace` values for all 7 types) and the eyes-on captures are the deferred
  CAR-18 deliverables, gated behind the re-derived assembly model.
- **No re-authoring landed here.** This ADR is documentation of the checkpointed
  WIP, folded into the model-truth track — not an independent slice. When the
  Excel-derived assembly model ships, this ADR is either promoted to Accepted (if the
  spacing math survives the derivation) or superseded by the model-truth ADR.
- **I1–I11 untouched**; the WIP scene-lab type-narrowing defect it also carried was
  fixed separately (CAR-11, commit `3b91317`).
