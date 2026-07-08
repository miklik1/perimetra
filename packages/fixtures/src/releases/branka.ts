/**
 * `branka@1` — the FIL pedestrian-gate (Branka) calculator transcribed into
 * DATA (CORE_SPEC §3), the second real product family after the sliding gate.
 * Ground truth: `~/gates/reference_files_unlocked/2026-PC_Branky_FINAL_PC.xlsx`
 * (`Kalkulace` sheet, formulas — not cached values). The generic @repo/engine
 * derives BOM + geometry from this release alone; the geometry is byte-true to
 * the Excel member chain (see `branka.spacing.test.ts` / `golden/branka.ts`).
 *
 * SCOPE (2026-07-08, drawing-spike prototype): the SIMPLEST structural variant,
 * `Branka 1xSP` (single leaf, single panel — Obrázky column B). The Excel encodes
 * eight variants via the `sDP`/`BnS` flags (T36/T37) — divided panels, double
 * leaves, a middle T-post divider — those are the CAR-34 breadth follow-on. This
 * release fixes both flags FALSE and models the clean rectangular leaf the drawing
 * emitter proves on. The Výplet fill DATA is identical to the sliding gate's (same
 * physical infill product) so the ADR-0098 spacing engine transfers verbatim.
 *
 * Dimension chain (`Kalkulace`, 1xSP = T36 FALSE / T37 FALSE):
 *   stileLength (A, F19) = clear_height − 100      (S6 − od-čepice 40 − od-země 60)
 *   railLength  (B, F20) = clear_width − 90
 *   latchPost   (C, F21) = clear_height − 30
 *   fillSlat    (D, F22) = railLength − 130
 *   hProfile    (F29)    = stileLength − 106
 *   fillCount   (K19)    = floor(hProfile / min_spacing) − 1   (the branka −O35 term)
 * then the shared Výplet spacing chain (ADR 0098): gaps / rawPitch / pitch (capped
 * unless `disable_max`) / remainder / offset1.
 *
 * Members (venkovní pohled): A = two vertical L-stiles, B = two horizontal L-rails
 * (a 45/45-mitred picture-frame leaf), C = the fixed latch post the leaf closes
 * against, h-profil = two vertical fill carriers, D = the horizontal fill slats.
 * Origin: leaf outer bottom-left at (0, from-ground), X across, Y up, Z depth.
 * Hardware sets (pant/kování/rám-šroub/zámek) + the full priced total are the
 * CAR-34 completion — the spike locks GEOMETRY (what the drawing derives from).
 */
import { expr, type ProductModelRelease } from "@repo/model";

export const brankaV1: ProductModelRelease = {
  id: "branka@1",
  modelId: "branka",
  version: 1,
  status: "published",

  parameters: [
    {
      key: "clear_width_mm",
      label: "Světlá šířka",
      type: "length_mm",
      domain: { kind: "range", min: 700, max: 1500 },
      adjustability: "user",
      deviation: {
        mode: "warn",
        bounds: { min: expr("600"), max: expr("1600") },
        note: "outside catalog range — single-leaf branka stability unverified",
      },
    },
    {
      key: "clear_height_mm",
      label: "Světlá výška",
      type: "length_mm",
      domain: { kind: "range", min: 1000, max: 2000 },
      adjustability: "user",
      deviation: {
        mode: "warn",
        bounds: { min: expr("800"), max: expr("2200") },
        note: "outside catalog range — leaf sag / hinge load unverified",
      },
    },
    { key: "fill_type_id", label: "Typ výplně", type: "select", adjustability: "user" },
    {
      key: "frame_material",
      label: "Materiál rámu",
      type: "select",
      domain: { kind: "enum", values: ["alu", "steel"] },
      default: "alu",
      adjustability: "user",
    },
    {
      key: "opening_direction",
      label: "Směr otevírání",
      type: "select",
      domain: { kind: "enum", values: ["left", "right"] },
      default: "left",
      adjustability: "user",
    },
    {
      key: "include_electrolock",
      label: "Elektrozámek",
      type: "bool",
      default: false,
      adjustability: "user",
    },
    {
      key: "include_installation",
      label: "Včetně montáže",
      type: "bool",
      default: false,
      adjustability: "user",
    },
    {
      key: "manufacturing_hours",
      label: "Hodiny výroby",
      type: "int",
      // Excel `Kalkulace` T30 (hand-entered per gate); the price-table multiplier
      // is the per-size default when the estimator leaves it blank.
      defaultExpr: expr("price.manufacturing_multiplier"),
      adjustability: "tenant",
    },
  ],

  // The seven infill types — IDENTICAL data to the sliding gate's `Výplet` sheet
  // (the same physical product; the branka `Výplet` sheet agrees cell-for-cell).
  // The spacing attrs feed the shared ADR-0098 engine; `disable_max_spacing`
  // (Excel `Vypnout max.?`) spreads the 2D planks and caps the 3D lamellas.
  optionSets: [
    {
      key: "fill",
      selectedBy: "fill_type_id",
      options: [
        {
          id: "lamela_113_3d",
          label: "Lamela 113 3D",
          attrs: {
            profile_mm: 113,
            dimension_type: "3D",
            min_spacing_mm: 90,
            section_code: "lamela_113",
            end_offset_1_mm: 43,
            end_offset_2_mm: 64,
            max_spacing_mm: 104,
            max_overlap_mm: 104,
            disable_max_spacing: false,
          },
        },
        {
          id: "lamela_120_3d",
          label: "Lamela 120 3D",
          attrs: {
            profile_mm: 120,
            dimension_type: "3D",
            min_spacing_mm: 90,
            section_code: "lamela_120",
            end_offset_1_mm: 24,
            end_offset_2_mm: 90,
            max_spacing_mm: 113,
            max_overlap_mm: 113,
            disable_max_spacing: false,
          },
        },
        {
          id: "planka_120_3d",
          label: "PLAŇKA 120 3D",
          attrs: {
            profile_mm: 120,
            dimension_type: "3D",
            min_spacing_mm: 105,
            section_code: "planka_120",
            end_offset_1_mm: 31,
            end_offset_2_mm: 92,
            max_spacing_mm: 122,
            max_overlap_mm: 122,
            disable_max_spacing: false,
          },
        },
        {
          id: "lamela_113_2d",
          label: "Lamela 113 2D",
          attrs: {
            profile_mm: 113,
            dimension_type: "2D",
            min_spacing_mm: 95,
            section_code: "lamela_113",
            end_offset_1_mm: 48,
            end_offset_2_mm: 65,
            max_spacing_mm: 180,
            max_overlap_mm: 113,
            disable_max_spacing: true,
          },
        },
        {
          id: "planka_120_2d",
          label: "PLAŇKA 120 2D",
          attrs: {
            profile_mm: 120,
            dimension_type: "2D",
            min_spacing_mm: 121,
            section_code: "planka_120",
            end_offset_1_mm: 30,
            end_offset_2_mm: 90,
            max_spacing_mm: 180,
            max_overlap_mm: 121,
            disable_max_spacing: true,
          },
        },
        {
          id: "planka_100_3d",
          label: "PLAŇKA 100 3D",
          attrs: {
            profile_mm: 100,
            dimension_type: "3D",
            min_spacing_mm: 88,
            section_code: "planka_100",
            end_offset_1_mm: 26,
            end_offset_2_mm: 77,
            max_spacing_mm: 102,
            max_overlap_mm: 102,
            disable_max_spacing: false,
          },
        },
        {
          id: "planka_100_2d",
          label: "PLAŇKA 100 2D",
          attrs: {
            profile_mm: 100,
            dimension_type: "2D",
            min_spacing_mm: 101,
            section_code: "planka_100",
            end_offset_1_mm: 10,
            end_offset_2_mm: 10,
            max_spacing_mm: 120,
            max_overlap_mm: 101,
            disable_max_spacing: true,
          },
        },
      ],
    },
  ],

  constraints: [
    {
      key: "branka.clear_width.wide",
      kind: "range",
      expr: expr("clear_width_mm <= 1300"),
      severity: "warn",
      scope: "instance",
    },
    {
      key: "branka.clear_height.tall",
      kind: "range",
      expr: expr("clear_height_mm <= 1800"),
      severity: "warn",
      scope: "instance",
    },
    // ADR 0098 overlap guard (Excel `max. překrytí`) — same conservative min-pitch
    // bound as the sliding gate.
    {
      key: "branka.fill.overlap_within_max",
      kind: "range",
      expr: expr("fill.profile_mm - fill.min_spacing_mm <= fill.max_overlap_mm"),
      severity: "warn",
      scope: "instance",
    },
  ],

  derivation: {
    derived: [
      // Frame member chain (Kalkulace F-column, 1xSP). od-čepice 40 + od-země 60
      // are inlined as the −100 stile deduction (matches the sliding gate's
      // inlined clear_height − 40).
      { key: "stileLength", expr: expr("clear_height_mm - 100") },
      { key: "railLength", expr: expr("clear_width_mm - 90") },
      { key: "latchPostLength", expr: expr("clear_height_mm - 30") },
      { key: "fillSlatLength", expr: expr("railLength - 130") },
      { key: "hProfileLength", expr: expr("stileLength - 106") },
      // Fill count: the branka floor(hProfile / min_spacing) − 1 (Excel K19's −O35
      // top/bottom term; O35 = 1 for the standard "Horní" build).
      { key: "fillCount", expr: expr("floor(hProfileLength / fill.min_spacing_mm) - 1") },
      // Shared ADR-0098 spacing chain (identical structure to the sliding gate).
      { key: "fillGaps", expr: expr("max(fillCount - 1, 1)") },
      {
        key: "fillRawPitch",
        expr: expr(
          "floor((hProfileLength - fill.end_offset_1_mm - fill.end_offset_2_mm) / fillGaps)",
        ),
      },
      {
        key: "fillPitch",
        expr: expr(
          "if(fill.disable_max_spacing, fillRawPitch, min(fillRawPitch, fill.max_spacing_mm))",
        ),
      },
      {
        key: "fillRemainder",
        expr: expr(
          "hProfileLength - fillGaps * fillPitch - fill.end_offset_1_mm - fill.end_offset_2_mm",
        ),
      },
      { key: "fillOffset1", expr: expr("fill.end_offset_1_mm + roundUp(fillRemainder / 2)") },
      // The fill region's foot: the h-profil carrier sits centred in the leaf
      // interior, so its base is from-ground + half the (stile − h-profil) slack.
      { key: "fillBaseY", expr: expr("60 + (stileLength - hProfileLength) / 2") },
      // Where the horizontal slats start across the leaf (centred: the slat is
      // 130 shorter than the rail, so 65 of inset each side).
      { key: "fillInsetX", expr: expr("(railLength - fillSlatLength) / 2") },
    ],

    parts: [
      // --- MATERIAL: the mitred L-profile leaf frame + the fixed latch post -----
      {
        path: "frame.lprofile",
        resolve: {
          role: "frame.l_profile",
          section: expr('"L50x50"'),
          material: expr("frame_material"),
        },
        name: "Sloupek L 50×50",
        // Excel T19: 2·stile + 2·rail + latch, rolled to whole metres.
        bom: {
          unit: "meter",
          lengthMm: expr("2 * stileLength + 2 * railLength + latchPostLength"),
          quantity: expr("roundUp((2 * stileLength + 2 * railLength + latchPostLength) / 1000)"),
          category: "material",
        },
        geometry: [
          // A — left stile (hinge side), full leaf height, řez 45/45.
          {
            key: "stileLeft",
            length: expr("stileLength"),
            at: [expr("0"), expr("60"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
            cuts: { left: expr("45"), right: expr("45") },
          },
          // A — right stile (latch side of the leaf), řez 45/45.
          {
            key: "stileRight",
            length: expr("stileLength"),
            at: [expr("railLength"), expr("60"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
            cuts: { left: expr("45"), right: expr("45") },
          },
          // B — bottom rail, řez 45/45 (picture-frame mitre with the stiles).
          {
            key: "railBottom",
            length: expr("railLength"),
            at: [expr("0"), expr("60"), expr("0")],
            cuts: { left: expr("45"), right: expr("45") },
          },
          // B — top rail.
          {
            key: "railTop",
            length: expr("railLength"),
            at: [expr("0"), expr("60 + stileLength"), expr("0")],
            cuts: { left: expr("45"), right: expr("45") },
          },
          // C — latch post: the fixed post the leaf closes against, on the latch
          // side, grounded (taller than the leaf: clear_height − 30). řez 90/90.
          {
            key: "latchPost",
            length: expr("latchPostLength"),
            at: [expr("railLength + 90"), expr("0"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
          },
        ],
      },
      // --- MATERIAL: the two vertical h-profil fill carriers -------------------
      {
        path: "frame.hprofile",
        resolve: {
          role: "frame.h_profile",
          section: expr('"h50"'),
          material: expr("frame_material"),
        },
        name: "h-profil 50",
        bom: {
          unit: "meter",
          lengthMm: expr("2 * hProfileLength"),
          quantity: expr("roundUp(2 * hProfileLength / 1000)"),
          category: "material",
        },
        geometry: [
          {
            key: "carrier",
            length: expr("hProfileLength"),
            at: [expr("fillInsetX + i * fillSlatLength"), expr("fillBaseY"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
            repeat: { count: expr("2"), var: "i" },
          },
        ],
      },
      // --- MATERIAL: the horizontal fill slats --------------------------------
      {
        path: "fill.material",
        resolve: {
          role: "fill",
          section: expr("fill.section_code"),
          material: expr("frame_material"),
        },
        name: "Výplň",
        bom: {
          unit: "meter",
          lengthMm: expr("fillCount * fillSlatLength"),
          quantity: expr("roundUp(fillCount * fillSlatLength / 1000)"),
          category: "material",
        },
        // ADR 0098 spacing: slat i sits `fillOffset1` above the carrier foot, then
        // steps by the real `fillPitch` (horizontal slats stacked up the leaf).
        geometry: [
          {
            key: "piece",
            length: expr("fillSlatLength"),
            at: [expr("fillInsetX"), expr("fillBaseY + fillOffset1 + i * fillPitch"), expr("0")],
            repeat: { count: expr("fillCount"), var: "i" },
          },
        ],
      },

      // --- ACCESSORIES (BOM-only) ---------------------------------------------
      {
        path: "fill.connectors",
        resolve: { role: "fill.connector" },
        name: "Spojovák výplně",
        // Excel P29: one connector run per slat, priced per piece.
        bom: { unit: "piece", quantity: expr("fillCount"), category: "accessory" },
      },

      // --- MANUFACTURING -------------------------------------------------------
      {
        path: "labor.manufacturing",
        resolve: { role: "labor.manufacturing" },
        name: "Výroba",
        bom: {
          unit: "hour",
          quantity: expr("manufacturing_hours"),
          pricePerUnit: expr("price.manufacturing_rate"),
          totalPrice: expr("price.manufacturing_rate * manufacturing_hours"),
          category: "manufacturing",
        },
      },

      // --- INSTALLATION --------------------------------------------------------
      {
        path: "labor.installation",
        resolve: { role: "labor.installation" },
        name: "Montáž",
        when: expr("include_installation"),
        bom: {
          unit: "set",
          quantity: expr("1"),
          totalPrice: expr("price.installation"),
          category: "installation",
        },
      },
    ],
  },

  // Drawing-rule spec (spike): the front elevation's feature-bound dimensions +
  // Excel member letters (Obrázky A–D). Each dimension's printed value is a
  // DERIVED key, so the drawing prints the engine's number (Excel fidelity).
  drawing: {
    views: [{ id: "front", projection: "front" }],
    rules: [
      {
        kind: "dimension",
        id: "overall.width",
        feature: { pieces: "frame.lprofile/railBottom" },
        measure: "x-extent",
        side: "bottom",
        derivedValue: "railLength",
      },
      {
        kind: "dimension",
        id: "overall.height",
        feature: { pieces: "frame.lprofile/stileLeft" },
        measure: "y-extent",
        side: "left",
        derivedValue: "stileLength",
      },
      {
        kind: "dimension",
        id: "latch.height",
        feature: { pieces: "frame.lprofile/latchPost" },
        measure: "y-extent",
        side: "right",
        derivedValue: "latchPostLength",
      },
      {
        kind: "dimension",
        id: "fill.slat.length",
        feature: { pieces: "fill.material/piece[0]" },
        measure: "x-extent",
        side: "top",
        derivedValue: "fillSlatLength",
      },
      {
        kind: "chain",
        id: "fill.pitch",
        feature: { pieces: "fill.material/piece[*]" },
        measure: "y-extent",
        side: "left",
        derivedValue: "fillPitch",
      },
      { kind: "label", id: "member.A", feature: { pieces: "frame.lprofile/stileLeft" }, text: "A" },
      {
        kind: "label",
        id: "member.B",
        feature: { pieces: "frame.lprofile/railBottom" },
        text: "B",
      },
      { kind: "label", id: "member.C", feature: { pieces: "frame.lprofile/latchPost" }, text: "C" },
      { kind: "label", id: "member.D", feature: { pieces: "fill.material/piece[0]" }, text: "D" },
    ],
  },

  ui: {
    steps: [
      {
        id: "rozmery",
        label: "Rozměry",
        groups: [{ id: "otvor", label: "Otvor", params: ["clear_width_mm", "clear_height_mm"] }],
      },
      {
        id: "konstrukce",
        label: "Konstrukce",
        groups: [
          {
            id: "ram",
            label: "Rám",
            params: ["frame_material", "opening_direction"],
          },
          { id: "vypln", label: "Výplň", params: ["fill_type_id"] },
        ],
      },
      {
        id: "vybava",
        label: "Výbava a práce",
        groups: [
          { id: "kovani", label: "Kování", params: ["include_electrolock"] },
          {
            id: "prace",
            label: "Práce",
            params: ["manufacturing_hours", "include_installation"],
          },
        ],
      },
    ],
  },

  // I2 delta-0 fixture: the GEOMETRY anchor (Excel `Branky` Kalkulace, 1xSP,
  // PLAŇKA 100 2D, 1000 × 1500). Member lengths + fill spacing are byte-true to
  // the Excel formulas. The priced total is deferred to CAR-34 (hardware sets).
  fixtures: [
    {
      name: "PLAŇKA 100 2D · 1xSP · 1000×1500 (Excel Branky geometry)",
      anchored: true,
      config: {
        clear_width_mm: 1000,
        clear_height_mm: 1500,
        fill_type_id: "planka_100_2d",
        frame_material: "alu",
        opening_direction: "left",
        include_electrolock: false,
        include_installation: false,
        manufacturing_hours: 10,
      },
      expected: {
        derived: {
          stileLength: 1400,
          railLength: 910,
          latchPostLength: 1470,
          fillSlatLength: 780,
          hProfileLength: 1294,
          fillCount: 11,
          fillPitch: 127,
          fillOffset1: 12,
        },
      },
    },
  ],
};
