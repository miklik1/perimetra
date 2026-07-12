# Swing-gate assembly-model derivation (from FIL's 2026 Excel)

**Status: AUTHORED (CAR-33, 2026-07-12).** The double-leaf swing gate (Brány
Křídlové) is now in `packages/fixtures/src/releases/swing-gate.ts`, resolving
against the new immutable `catalog@3`. The generic `@repo/engine` reproduces the
workbook's own VZOR total `Kalkulace` U34 = **55 843.4** byte-for-byte (delta-0;
`swing-gate.delta0.test.ts`).

Derived by deep-analysing FIL's 2026 `Brány Křídlové` workbook on both axes the
model-truth order names: the **formulas** (dimensional truth) and the toggle
predicates that select the member catalogue. Following the sliding-gate
precedent (CAR-18), the under-determined 3D topology is derived from the product
itself and shipped — a FIL photo is post-finished-product fine-tuning, not a
blocker (Martin's standing derive-and-ship rule).

Source: `~/gates/reference_files_unlocked/2026-PC_Brány_Křídlové_FINAL_PC.xlsx` —
`Kalkulace` sheet = the member table (left, cols B–F) + the priced BOM (right,
cols P–U); `Výplet` sheet = the 7 fill-type params (shared cell-for-cell with the
sliding/fence families); `Obrázky` sheet = the fill × toggle preview matrix.

---

## 1. The three structural toggles — VZOR bakes all three TRUE

The workbook is parametric over three booleans (cells `T37`/`T38`/`T39`) that
reshape the member catalogue. The VZOR (sample) sets all three TRUE, and **v1
bakes that configuration** — the branka precedent (fix the toggles, defer the
breadth). The FALSE branches have no worked sample to anchor against and touch
the under-determined single-leaf geometry (§6), so authoring them blind would
violate the Excel-ground-truth discipline; they are the breadth follow-on.

| Toggle          | Czech               | TRUE (VZOR — what v1 builds)                                                                                                                                   | FALSE (deferred)                                                                             |
| --------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **KSŠ** (`T37`) | Křídla Stejná Šířka | symmetric two-leaf: both leaves `(opening − 70)/2` wide; the meeting stile C is a Sloupek **T** astragal                                                       | single leaf on the handle width `S8`; C reverts to a Sloupek L; the E–I member rows activate |
| **sDP** (`T38`) | s Dělící Příčkou    | a horizontal dividing rail splits each leaf's infill into an UPPER (Horní) and LOWER (Spodní) section by the `S12 = 0.335` ratio → two independent plank banks | one undivided infill panel per leaf (`F31 = F19 − 106`, no lower band)                       |
| **BnS** (`T39`) | Brána na Sloupech   | the gate hangs on its own two 100×100 posts (member F, priced)                                                                                                 | mounts to existing structure; no post row, the leaf-width math loses the 2×100 allowance     |

`T40` (Mad, = 2) is a **drawing/image selector only** — it feeds `T42` which
builds an `ADDRESS()` into the Obrázky preview sheet. It has zero effect on any
member, quantity, or price, so it is not modelled.

Also **alu-only** and **no motor** in v1: the steel `sloup_100`/fill SKUs are
unpriced across the corpus (un-anchorable), and the VZOR priced sum U34 carries
no motor line (the `Kalkulace` H-column "Pohon SOMFY" is an un-priced fitter's
checklist note, not a BOM row).

---

## 2. Member inventory — FULLY determined by the Excel `Kalkulace` sheet

Left table: col **C** = the callout letter, **D** = part name, **E** = quantity
formula, **F** = cut-length formula. Verbatim for the VZOR (S4 = 3000 clear
width, S5 = 1500 clear height, S12 = 0.335, fill PLAŇKA 120 3D), all three
toggles TRUE:

| Callout | Part (`Kalkulace` D-col)      | Profile | Qty | Length mm | Length formula (Excel cell)                         |
| ------- | ----------------------------- | ------- | --- | --------- | --------------------------------------------------- |
| **A**   | Sloupek L — vertical stiles   | L 45/45 | 3   | 1400      | `clear_height − 100` (F19 = S5 − T4 − T5)           |
| **B**   | Sloupek L — horizontal rails  | L 45/45 | 4   | 1465      | `(opening − 70) / 2` (F20; two leaves × top+bottom) |
| **C**   | Sloupek T — centre astragal   | T 45/45 | 1   | 1470      | `clear_height − 30` (F21)                           |
| **D**   | Sloupek T — divider crossbars | T 90/90 | 2   | 1365      | `leafWidth − 100` (F22; one per leaf)               |
| **E**   | Výplň — PLAŇKA 120 3D planks  | plank   | 18  | 1335      | `leafWidth − 130` (F23; `2 × (K19 + K21)` planks)   |
| **F**   | Sloup 100 — hinge posts       | 100×100 | 2   | 1510      | `clear_height + 10` (F24)                           |
| **h**   | h-profil 50 — upper carriers  | h 50    | 4   | 823       | `round((F19 − 162) × 0.665)` (F31, Horní)           |
| **h**   | h-profil 50 — lower carriers  | h 50    | 4   | 415       | `round((F19 − 162) × 0.335)` (F32, Spodní)          |

**BOM roll-up (right table, cols P–U):** each priced material line rolls the
member cut lengths into metres via `ROUNDUP(Σ mm / 1000)`:

| Line                | Feeds                               | Metres | × price | =            |
| ------------------- | ----------------------------------- | ------ | ------- | ------------ |
| Sloupek L 50×50     | A (3×1400) + B (4×1465) = 10 060 mm | 11     | 427     | 4 697        |
| Sloupek T 50×50     | C (1×1470) + D (2×1365) = 4 200 mm  | 5      | 495     | 2 475        |
| h-profil 50         | 4×823 + 4×415 = 4 952 mm            | 5      | 200     | 1 000        |
| Výplň               | 18×1335 = 24 030 mm                 | 25     | 275     | 6 875        |
| Sloup 100×100       | F (2×1510) = 3 020 mm               | 4      | 1080    | 4 320        |
| Limit S             | —                                   | 1 ks   | 420     | 420          |
| Zástrč              | —                                   | 1 ks   | 400     | 400          |
| Sada k rámu (šroub) | —                                   | 2 sets | 1700    | 3 400        |
| Kování klika/koule  | —                                   | 1 ks   | 1700    | 1 700        |
| Sada pant           | —                                   | 4 ks   | 675     | 2 700        |
| Spojovák výplně     | 4 per plank (18×4)                  | 72 ks  | 4.95    | 356.4        |
| Výroba              | Excel T32                           | 20 h   | 850     | 17 000       |
| Montáž              | —                                   | 1      | 10 500  | 10 500       |
| **Celkem (U34)**    |                                     |        |         | **55 843.4** |

This table is the authoritative member + BOM spec. The counts and length
formulas are not in question — they reproduce U34 exactly.

---

## 3. Fill placement — the ADR-0098 chain, run TWICE (Horní + Spodní)

Because sDP splits the infill, the Výplet spacing chain runs once per section
(the sliding gate runs it once for its single band). Section heights are
`upperSectionHeight = round((frameInnerHeight − 162) × 0.665)` = 823 and
`lowerSectionHeight = round(… × 0.335)` = 415 at the VZOR. Per section:

```
count     = floor(H / min_spacing) − O   (O = 1 upper [O37], 0 lower [O38])
gaps      = max(count − 1, 1)
rawPitch  = floor((H − end1 − end2) / gaps)
pitch     = disable_max ? rawPitch : min(rawPitch, max_spacing)
remainder = H − gaps·pitch − end1 − end2
offset1   = end1 + roundUp(remainder / 2)
```

VZOR (PLAŇKA 120 3D, end1 31 / end2 92 / min 105 / max 122): the upper band is
6 planks at pitch **122** (raw 140 capped), offset1 **76**; the lower band is
3 planks at pitch **122** (raw 146 capped), offset1 **55** — these reproduce the
workbook's OWN VZOR cells (J20 = 122, H20 = 76, J22 = 122, H22 = 55), the
anti-tautology anchor that validates the transcription for the other six fills
(`swing-gate.spacing.test.ts`).

---

## 4. What is UNDER-DETERMINED — derived, not FIL-blocked

The member **numbers** are fully determined; the **3D topology** is not, and is
derived from the product (per Martin's derive-and-ship rule, mirroring the
sliding-gate tail CAR-18). The `swing-gate.geometry.test.ts` position golden
locks the choices below so a future authoring slip fails in CI:

1. **The 70 mm gap budget split.** Excel gives `leafWidth = (opening − 70)/2`
   but never how the 70 mm divides. Derived: 15 mm hinge clearance each side,
   40 mm central meeting gap (`15 + 1465 + 40 + 1465 + 15 = 3000`).
2. **The `E19 = 3` vertical stile count** for a two-leaf gate is a hand constant
   (not `4`): the four leaf verticals are 3 Sloupek-L stiles + 1 Sloupek-T
   astragal. Derived layout: left-outer L, left-inner L, right-inner **T**
   (the meeting astragal, run to the ground where the Zástrč drop-bolt seats),
   right-outer L.
3. **The divider rail's vertical position** is only implied by the S12 split;
   derived as sitting above the lower section band.
4. **Hinge-post standoff, hinge offsets, leaf swing arc, Z-depth stack** — pure
   presentation the renderer supplies; a FIL photo / shop-drawing would refine
   them in a fidelity pass.

---

## 5. Catalog additions (`catalog@3`)

The swing gate resolves five brand-new hardware components with no precedent in
the corpus — `limit_s` (Limit S), `zastrc` (Zástrč), `frame_kit_bolted` (the
bolted frame kit, a distinct SKU + role from the welded `frame_kit`@1300),
`kovani_klika_koule` (handle set), `sada_pant` (hinge set) — plus a gate-post
role. The 100×100 post `sloup_100` already exists in `catalog@2` under the
`fence.post` role only; `catalog@3` re-declares it with both `fence.post` and
`frame.post` (catalogs are immutable, so the added role is a new-version fact —
the code and 1080 price are unchanged). Everything else (Sloupek L/T, h-profil
50, the four fill profiles, Výroba rate, Montáž) resolves + prices against the
existing catalog@1 roles.

---

## 6. Follow-on (deferred, not blocking)

- **Toggle breadth** — the KSŠ / sDP / BnS FALSE branches (single-leaf,
  undivided, postless), each needing its own worked sample to anchor.
- **Multi-material** — steel frame + fills once their SKUs are priced.
- **Motor line** — when a swing-gate motor is priced in the workbook.
- **Site-graph ports** — swing-gate ↔ fence connection (no ports in v1).
- **3D fidelity** — hinge/astragal detail from a FIL photo (taste, not price).
- **Drawing spec + self-golden** — once the technical-drawing emitter reaches
  the swing family (sliding-gate itself has none yet).
