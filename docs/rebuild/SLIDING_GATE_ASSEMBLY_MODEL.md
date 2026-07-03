# Sliding-gate assembly-model derivation (from FIL's 2026 Excel)

**Status: DERIVATION FOR REVIEW — do NOT author the fixture from this until
Martin picks (CAR-25).** Produced 2026-07-03 (model-truth wave, HQ order
2026-07-02) by deep-analysing FIL's 2026 `Samonosná brána` workbooks on both
axes the order named: the **formulas** (dimensional truth) and the **embedded 2D
previews** (assembly truth). Cross-checked against the proven gates-MVP 3D
(`~/gates`) and the shipped goldens. Where the Excel under-determines the 3D
assembly, this says so and lists what a FIL photo/drawing would resolve — nothing
is invented.

Sources (all agree cell-for-cell on the numbers):

- `~/gates/reference_files_unlocked/2026-PC_Samonosna_brana_FINAL_PC-do 4,5m.xlsx`
  (and the `-do 5m` / `-výroba` variants) — `Kalkulace` sheet = the member table
  (BOM + cut list + length formulas), `Výplet` sheet = the 7 fill-type params,
  `Obrázky` sheet = the fill × panel-count × opening-direction preview matrix.
- The embedded previews: `xl/media/image1–9.png` (labeled elevation drawings,
  callouts **A–I** + a side section) and `xl/drawings/drawing2.xml` (the shape
  layer that places them). These are FIL's own assembly drawings.
- The proven gates-MVP: `~/gates/packages/calc-engine/src/sliding-gate.ts`
  (dimension math) + `packages/3d/src/sliding-gate.tsx` (the renderer Martin
  called proven-correct) + `packages/products/.../drawings/sliding.ts` (2D).

---

## 1. Member inventory — FULLY determined by the Excel `Kalkulace` sheet

`Kalkulace` column **C** carries the drawing callout letter; **D** the part
name; **E** the quantity formula; **F** the cut-length formula. Verbatim, for the
worked 4.0 m / 3-panel / LAMELA 113 3D example (Q4 = 4000, Q5 = 1500, U6 = 35°,
U10 = 3):

| Callout | Part (Excel `Kalkulace` D-col) | Profile (řez)     | Qty                              | Length mm | Length formula (Excel cell)                            |
| ------- | ------------------------------ | ----------------- | -------------------------------- | --------- | ------------------------------------------------------ |
| **A**   | Sloupek L — front stile        | L 45/45           | 1                                | 1320      | `frameHeight − 140` (F19; frameHeight = clearH − 40)   |
| **B**   | Sloupek T — panel divider(s)   | T 90/90           | `panel_count − 1` = 2            | 1220      | `A − 100` (F20)                                        |
| **C**   | Sloupek L — rear stile         | L 90/90           | 1                                | 1220      | `A − 100` (F21)                                        |
| **D**   | Sloupek L — **diagonal brace** | L (mitre 55/17,5) | 1                                | 2214      | `round((A − 50) / sin(angle))` (F22)                   |
| **E**   | Sloupek L — **top rail**       | L (mitre 17,5/45) | 1                                | 4700      | `outerFrameWidth + 500` (F23; outerFW = opening + 200) |
| **F**   | Sloupek L — **bottom carrier** | L (mitre 90/45)   | 1                                | 5336      | `opening × 1.334` (F24 = U8)                           |
| **G**   | Kolejnice — running track      | C-track           | 1                                | 5336      | `= F` (F25)                                            |
| **h**   | h-profil 50 — fill uprights    | h 50              | `panel_count × 2` = 6            | 1205      | `A − 115` (F32)                                        |
| **I**   | Výplň — infill slat            | per fill type     | `slats/panel × panel_count` = 39 | 1313      | panel inner width (F26)                                |

Supporting derived quantities (all Excel-exact):

- `outerFrameWidth = opening + 200` (U4, "překrytí rámu" = frame overlap)
- `frameHeight = clearHeight − 40` (U5, "rám- výška-40 mm")
- `railLength (kolejnice) = opening × 1.334` (U8) — the canonical coefficient is
  **1.333**; the `-výroba` workbooks carry a `×1.334` typo (this is the same VZOR
  typo ADR 0097 already caught behind the `81849.192` non-anchor — the engine
  uses 1.333, and the 2-panel-3D `×1.4` is a separate case, see §5).
- panel pitch (centre) `= (outerFrameWidth − 50) / panel_count` (F28); panel
  clear width `= (outerFrameWidth − 200) / panel_count` (F29).
- mitre cuts are **formulas of the suspension angle**: D `= (90−α)/(α/2)` →
  `55/17,5`; E `= (α/2)/45` → `17,5/45`; F `= 90/45` (B22/B23/B24).

**This table is the authoritative member spec. The counts and length formulas
are not in question — they reproduce the shipped BOM/price goldens.**

---

## 2. Assembly topology — the Excel PREVIEWS (assembly truth)

Every preview (`image1–9`, the `Obrázky` matrix) draws the same skeleton, mirrored
by opening direction (`Vlevo`/`Vpravo` = left/right; the tail flips side):

- The **leaf** is the framed rectangle: **A** (front stile) · **C** (rear stile)
  · **B** dividers between them · **E** top rail · **F/G** bottom carrier + track ·
  **I** infill in each panel, held by the **h**-profiles. Every leaf member's ends
  meet another leaf member — no floating parts.
- The **counterweight tail (protiváha)** extends **behind the rear stile C, over
  the support wall**: the bottom carrier **F** (opening × 1.334 = 5336 vs the 4200
  frame → **~1136 mm of tail**) runs past C, the top rail **E** (+500) runs part-way,
  and the **diagonal D** closes the triangle — it rises from the tail's rear-bottom
  up to the leaf's rear-top corner (callout C). In the previews D sits in this
  tail, over the wall (drawn with hidden/dashed lines behind the masonry).

This is the assembly Martin means by "the sliding gate should make sense": a
cantilever gate is a **leaf + a counterweight tail braced by D**, riding the
**G** track — not a bare framed rectangle.

---

## 3. What the HEAD model actually builds — and the gaps

`packages/fixtures/src/releases/sliding-gate.ts` @ HEAD (post-reseed the DB now
matches it). Authored geometry vs the Excel:

| Excel member           | HEAD status                                              | Gap                                                                                                                                                                                               |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A front stile          | ✅ `postA`, len `frameHeight−140`                        | correct                                                                                                                                                                                           |
| B dividers             | ✅ `frame.tpost`, T50×50, qty `panel−1`, len `postA−100` | correct (profile 50 not 90)                                                                                                                                                                       |
| C rear stile           | ✅ `postB`, len `postA−100`                              | correct                                                                                                                                                                                           |
| **E top rail**         | ❌ **absent**                                            | **`lMemberE = opening+700` is DEFINED but wired to the bottom carrier, not a top rail. The post/divider crowns attach to nothing — the single biggest "gap not attached to anything."**           |
| F bottom carrier       | ⚠️ `bottom`, len `opening+700`                           | wrong length (Excel = opening×1.334 ≈ opening+1336 at 4 m); conflated with E's role                                                                                                               |
| G track                | ⚠️ `rail`, len `opening×1.333/1.4`, z=60                 | present but far end meets nothing; role split from F                                                                                                                                              |
| **D diagonal**         | ⚠️ present, but **inside the leaf**                      | starts at C's crown, **descends into the leaf** to mid-span (the ADR-0095 fix corrected it from ascending-into-the-sky, but its home is the tail, not the leaf); cut `angle/90` ≠ Excel `55/17,5` |
| **Counterweight tail** | ❌ **absent**                                            | no tail frame, no tail-end vertical, no tail infill; the `top_guide_beam` (Nosník V, literal 6500) is a self-flagged inferred stand-in with both ends free                                        |
| h-profiles             | ✅ qty `panel×2`, len `postA−115`                        | correct                                                                                                                                                                                           |
| I infill               | ✅ count + spacing                                       | count correct; **placement** = the ADR-0098 WIP (Excel `Kalkulace` math — see §4)                                                                                                                 |
| catch/tower post       | ⚠️ left side only                                        | no post at the right port anchor                                                                                                                                                                  |

**The precise diagnosis of Martin's "models are wrong overall, gaps not attached
to anything":** (1) the whole **top rail E is missing**, so post crowns float;
(2) the **counterweight tail is absent** and the **diagonal is stranded inside the
leaf** bracing nothing; (3) **F/G are conflated** and one bar's far end meets
nothing. The leaf verticals, h-profiles and infill are sound.

---

## 4. Fill placement — the ADR-0098 WIP IS the Excel `Kalkulace` math (verified)

The 5 WIP derived keys transcribe the Excel cells exactly:

| WIP key (ADR 0098)                                          | Excel `Kalkulace` cell                   |
| ----------------------------------------------------------- | ---------------------------------------- |
| `fillRawPitch = floor((hProfileLength − end1 − end2)/gaps)` | J20 (inner ROUNDDOWN)                    |
| `fillPitch = if(disable_max, raw, min(raw, max_spacing))`   | J20 (the FALSE/max branch on `Výplet!B`) |
| `fillOffset1 = end1 + roundUp(remainder/2)`                 | H20                                      |
| `fillRemainder`, `fillGaps`                                 | the H20/I20 sub-terms                    |

The `Výplet` sheet params (rows 2–8) match ADR-0097's transcription cell-for-cell:
`Vypnout max.?` (disable_max) is **True for all 2D fills** (planks spread to the
wide `max_spacing`) and **False for 3D** (lamellas capped tight → the overlap look).
**So the WIP spacing math is faithful** — it earns promotion to golden-locked ONE
the assembly model around it is settled (that is why ADR 0098 is Proposed, not
Accepted: don't lock a golden the tail rework may shift).

---

## 5. The 7-fill exposure map

Seven fills, five distinct preview images. The `Obrázky` matrix carries 5 rows
(LAMELA 113 3D, LAMELA 120 3D, PLAŇKA 120 3D, LAMELA 113 2D, PLAŇKA 120 2D); the
Kalkulace `F38` lookup maps the two PLAŇKA 100 types onto the PLAŇKA 120 previews
(`IF(T12="PLAŇKA 100 3D","PLAŇKA 120 3D", IF(…"PLAŇKA 100 2D","PLAŇKA 120 2D",…))`).
So planka_100 3D/2D share planka_120's drawing — expected, same profile family.
The `railMultiplier` 1.4 applies **only to 2-panel + 3D fill**; every other
combination is 1.333 (a real Excel case split, not the výroba `1.334` typo).

---

## 6. What is UNDER-DETERMINED — needs Martin's call and/or a FIL input

The **member numbers are fully determined**; the **3D tail topology is not**, and
I will not invent it:

1. **The counterweight tail's 3D geometry.** The previews show it in _elevation_
   only (a 2D triangle behind the wall). They do **not** fix: the tail's depth
   plane (is D in the leaf plane, bracing the frame, or offset into a tail truss?),
   the tail's rear-end vertical, or the tail infill. Tellingly, **the proven
   gates-MVP also never draws the tail** — its docs state the tail members
   (half-height JAKL pieces "for the counterweight/tail section") are **priced in
   the BOM but deliberately simplified out of every renderer**. So no existing 3D
   code is a reference for the tail; only the Excel elevation is, and it is 2D.
   → **A FIL photo or a side/plan shop-drawing of an installed gate would resolve
   this** (tail length behind the leaf, D's anchor points, tail infill presence).

2. **Diagonal D placement decision.** Given (1): author D in the tail per the
   preview elevation (needs the tail built first), or keep the leaf-plane brace
   both current renderers use (simpler, but reads as "attached to nothing")?
   This is Martin's design call, not an Excel fact.

3. **Cut-angle fidelity.** Excel D=`55/17,5`, E=`17,5/45`, F=`90/45`; HEAD uses
   `angle/90`. Determined by the Excel — safe to fix — but only matters once the
   cut list / 2D drawing surfaces are in scope.

4. **Profiles.** Excel B/C are 90/90; HEAD uses 50×50 for the whole frame. Cosmetic
   at render scale; a fidelity item, not a correctness one.

5. **Antracit micro-texture** (Martin's flagged taste item): gloss reads right;
   the missing fine surface texture is a material-authoring/taste call, out of the
   dimensional scope — flagged, not specced.

---

## 7. Recommendation (for Martin's pick — no code until then)

- **Author now, high confidence (Excel-determined):** add the **top rail E**;
  split **F (bottom carrier, opening×1.334)** from **G (track)**; fix the **cut
  angles**. These close the "gaps not attached to anything" for the _leaf_ and
  are pure formula transcription.
- **Decide first (under-determined):** the **counterweight tail + diagonal D
  home**. Recommend getting **one FIL photo / side drawing** before authoring the
  tail; until then, either (a) build the leaf correctly and leave D as an explicit
  in-leaf brace with a `// FIL-blocked: tail topology` flag, or (b) hold the whole
  diagonal+tail behind that photo. This is the CAR-25 decision.
- Keep the **ADR-0098 fill spacing** as-is (it is the Excel math) and golden-lock
  it once the assembly is settled.
