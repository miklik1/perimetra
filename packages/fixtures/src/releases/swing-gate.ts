/**
 * `swing-gate@1` — the double-leaf swing gate (Brány Křídlové) transcribed into
 * DATA (CORE_SPEC §3), derived from FIL's 2026 `Brány Křídlové` Excel workbook
 * (`~/gates/reference_files_unlocked/2026-PC_Brány_Křídlové_FINAL_PC.xlsx`,
 * `Kalkulace` sheet). The generic @repo/engine reproduces the workbook's own
 * VZOR total U34 = 55843.4 byte-for-byte (delta-0; see swing-gate.delta0.test).
 *
 * SCOPE — the VZOR toggle configuration only (CAR-33, first slice). The Excel
 * has three structural toggles (KSŠ/sDP/BnS, cells T37/T38/T39) that reshape the
 * member table; the sample all three set TRUE:
 *   - KSŠ (Křídla Stejná Šířka) = symmetric two-leaf split — both leaves are
 *     equal halves, each (opening − 70)/2 wide.
 *   - sDP (s Dělící Příčkou)    = a horizontal dividing rail splits each leaf's
 *     infill into an UPPER (Horní) and LOWER (Spodní) section by the S12 ratio.
 *   - BnS (Brána na Sloupech)   = the gate hangs on its own 100×100 posts.
 * v1 BAKES that configuration (the branka precedent: fix the toggles, defer the
 * breadth). The FALSE branches (single-leaf on the handle width S8, undivided,
 * postless) have no worked sample to anchor against and touch the
 * under-determined single-leaf geometry, so authoring them blind would violate
 * the Excel-ground-truth discipline — they are the breadth follow-on. Likewise
 * v1 is alu-only (steel `sloup_100`/fills are unpriced in the corpus) and has no
 * motor line (the VZOR priced sum U34 carries none — the H-column "Pohon" note
 * is an un-priced checklist item, not a BOM row).
 *
 * Dimension chain (Kalkulace; clear width S4, clear height S5, T4=40 cap
 * allowance, T5=60 ground allowance, S12=0.335 division ratio, all Excel-exact):
 *   frameInnerHeight  = clear_height − 100          (F19 = S5 − T4 − T5)
 *   leafWidth         = (opening − 70) / 2          (F20, KSŠ half-split)
 *   centerStileHeight = clear_height − 30           (F21, the astragal T-stile)
 *   dividerRailLength = leafWidth − 100             (F22, the sDP crossbar)
 *   plankLength       = leafWidth − 130             (F23, horizontal infill)
 *   postHeight        = clear_height + 10           (F24, the 100×100 post)
 *   usableInfillHeight= frameInnerHeight − 162      (fixed frame deduction)
 *   upperSectionHeight= round(usable × (1 − 0.335)) (F31, Horní)
 *   lowerSectionHeight= round(usable × 0.335)       (F32, Spodní)
 * Each section then runs the ADR-0098 Výplet spacing chain independently (the
 * upper/lower plank counts drop O37=1 / O38=0 respectively — Excel K19/K21).
 */
import { expr, type ProductModelRelease } from "@repo/model";

export const swingGateV1: ProductModelRelease = {
  id: "swing-gate@1",
  modelId: "swing-gate",
  version: 1,
  status: "published",

  parameters: [
    {
      key: "opening_width_mm",
      label: "Šířka otvoru",
      type: "length_mm",
      domain: { kind: "range", min: 1000, max: 6000 },
      adjustability: "user",
      // Placeholder deviation envelope — real values are a fabricator-extraction
      // item (mirrors sliding-gate's stance).
      deviation: {
        mode: "warn",
        bounds: { min: expr("900"), max: expr("6500") },
        note: "outside catalog range — leaf sag / hinge load unverified",
      },
    },
    {
      key: "clear_height_mm",
      label: "Průjezdná výška",
      type: "length_mm",
      domain: { kind: "range", min: 800, max: 2500 },
      adjustability: "user",
      deviation: {
        mode: "hard",
        bounds: { min: expr("700"), max: expr("2600") },
        note: "frame dimension chain and wind load break outside this envelope",
      },
    },
    {
      key: "ground_elevation_mm",
      label: "Výška terénu",
      type: "length_mm",
      domain: { kind: "range", min: -5000, max: 5000 },
      default: 0,
      adjustability: "user",
    },
    { key: "fill_type_id", label: "Typ výplně", type: "select", adjustability: "user" },
    {
      key: "manufacturing_hours",
      label: "Hodiny výroby",
      type: "int",
      // Excel T32 (hand-entered 20). Defaults to the price-table multiplier when
      // the estimator leaves it blank (MVP rule; sliding-gate precedent).
      defaultExpr: expr("price.manufacturing_multiplier"),
      adjustability: "tenant",
    },
    {
      key: "include_installation",
      label: "Včetně montáže",
      type: "bool",
      default: true,
      adjustability: "user",
    },
  ],

  // The seven cantilever Výplet (infill) types — byte-identical to the shared
  // sliding-gate/fence-run set (all three families' Excel `Výplet` sheets agree
  // cell-for-cell). `min_spacing_mm` drives each section's plank count; the
  // placement attrs (`end_offset_*`, `max_spacing_mm`, `disable_max_spacing`)
  // feed the ADR-0098 spacing chain, run once per section (upper + lower).
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
    // Judgment limits only — hard input ranges are parameter domains (I7 gate).
    {
      key: "swing.opening_width.wide",
      kind: "range",
      expr: expr("opening_width_mm <= 5000"),
      severity: "warn",
      scope: "instance",
    },
    {
      key: "swing.clear_height.tall",
      kind: "range",
      expr: expr("clear_height_mm <= 2000"),
      severity: "warn",
      scope: "instance",
    },
    // ADR 0098 fill overlap guard (Excel `max. překrytí`, cells L20/L22): at the
    // tightest (min-spacing) pitch the slat overlap is `profile − min_spacing`,
    // which must stay within the fill's allowed maximum. Attr-only (instance
    // constraints run pre-derivation, so no `*Section*`/`*Fill*` derived keys).
    {
      key: "swing.fill.overlap_within_max",
      kind: "range",
      expr: expr("fill.profile_mm - fill.min_spacing_mm <= fill.max_overlap_mm"),
      severity: "warn",
      scope: "instance",
    },
  ],

  derivation: {
    derived: [
      // Division ratio S12 (=L37/1000): the fraction of usable infill height the
      // LOWER (Spodní) section gets; the upper gets the complement.
      { key: "divisionRatio", expr: expr("0.335") },

      // --- the Excel `Kalkulace` dimension chain (VZOR toggle branch) ---
      { key: "frameInnerHeight", expr: expr("clear_height_mm - 100") },
      { key: "leafWidth", expr: expr("(opening_width_mm - 70) / 2") },
      { key: "centerStileHeight", expr: expr("clear_height_mm - 30") },
      { key: "dividerRailLength", expr: expr("leafWidth - 100") },
      { key: "plankLength", expr: expr("leafWidth - 130") },
      { key: "postHeight", expr: expr("clear_height_mm + 10") },
      { key: "usableInfillHeight", expr: expr("frameInnerHeight - 162") },
      {
        key: "upperSectionHeight",
        expr: expr("round(usableInfillHeight * (1 - divisionRatio))"),
      },
      { key: "lowerSectionHeight", expr: expr("round(usableInfillHeight * divisionRatio)") },

      // --- UPPER section Výplet spacing (ADR 0098; Excel K19/I20/J20/H20; O37=1) ---
      {
        key: "upperFillCount",
        expr: expr("floor(upperSectionHeight / fill.min_spacing_mm) - 1"),
      },
      { key: "upperFillGaps", expr: expr("max(upperFillCount - 1, 1)") },
      {
        key: "upperFillRawPitch",
        expr: expr(
          "floor((upperSectionHeight - fill.end_offset_1_mm - fill.end_offset_2_mm) / upperFillGaps)",
        ),
      },
      {
        key: "upperFillPitch",
        expr: expr(
          "if(fill.disable_max_spacing, upperFillRawPitch, min(upperFillRawPitch, fill.max_spacing_mm))",
        ),
      },
      {
        key: "upperFillRemainder",
        expr: expr(
          "upperSectionHeight - upperFillGaps * upperFillPitch - fill.end_offset_1_mm - fill.end_offset_2_mm",
        ),
      },
      {
        key: "upperFillOffset1",
        expr: expr("fill.end_offset_1_mm + roundUp(upperFillRemainder / 2)"),
      },

      // --- LOWER section Výplet spacing (Excel K21/I22/J22/H22; O38=0) ---
      { key: "lowerFillCount", expr: expr("floor(lowerSectionHeight / fill.min_spacing_mm)") },
      { key: "lowerFillGaps", expr: expr("max(lowerFillCount - 1, 1)") },
      {
        key: "lowerFillRawPitch",
        expr: expr(
          "floor((lowerSectionHeight - fill.end_offset_1_mm - fill.end_offset_2_mm) / lowerFillGaps)",
        ),
      },
      {
        key: "lowerFillPitch",
        expr: expr(
          "if(fill.disable_max_spacing, lowerFillRawPitch, min(lowerFillRawPitch, fill.max_spacing_mm))",
        ),
      },
      {
        key: "lowerFillRemainder",
        expr: expr(
          "lowerSectionHeight - lowerFillGaps * lowerFillPitch - fill.end_offset_1_mm - fill.end_offset_2_mm",
        ),
      },
      {
        key: "lowerFillOffset1",
        expr: expr("fill.end_offset_1_mm + roundUp(lowerFillRemainder / 2)"),
      },

      // Plank totals (Excel E23 = 2 × (K19 + K21) — both leaves).
      { key: "plankCountPerLeaf", expr: expr("upperFillCount + lowerFillCount") },
      { key: "plankCount", expr: expr("2 * plankCountPerLeaf") },

      // --- BOM roll-up lengths (Excel T19–T23 numerators; the ROUNDUP(/1000)
      //     lands on each part's bom.quantity) ---
      // Sloupek L: 3 vertical stiles (A) + 4 horizontal rails (B).
      { key: "lProfileTotalMm", expr: expr("3 * frameInnerHeight + 4 * leafWidth") },
      // Sloupek T: 1 centre astragal stile (C) + 2 divider crossbars (D).
      { key: "tProfileTotalMm", expr: expr("centerStileHeight + 2 * dividerRailLength") },
      // h-profil 50: 4 upper carriers + 4 lower carriers.
      { key: "hProfileTotalMm", expr: expr("4 * upperSectionHeight + 4 * lowerSectionHeight") },
      // Výplň: every plank, both leaves, both sections.
      { key: "fillTotalMm", expr: expr("plankCount * plankLength") },
      // Sloup 100: 2 hinge posts (F).
      { key: "postTotalMm", expr: expr("2 * postHeight") },
      // Spojovák výplně: 4 connectors per plank (Excel T31 = SUM(E23) × 4).
      { key: "spojovakCount", expr: expr("plankCount * 4") },

      // --- geometry helper positions (presentation only, I4) ---
      // The two leaves sit inboard of the opening: 15 mm hinge clearance each
      // side, a 40 mm central meeting gap (15 + 1465 + 40 + 1465 + 15 = 3000 at
      // the VZOR). The 70 mm total is the Excel F20 gap budget; its split is
      // under-determined (see SWING_GATE_ASSEMBLY_MODEL.md §6) — derived here.
      { key: "leafBottomY", expr: expr("ground_elevation_mm + 60") },
      { key: "leafTopY", expr: expr("ground_elevation_mm + 60 + frameInnerHeight") },
      { key: "leftLeafX", expr: expr("15") },
      { key: "rightLeafX", expr: expr("opening_width_mm - 15 - leafWidth") },
      // The divider crossbar sits above the lower section; the upper/lower plank
      // bands seat off it and off the leaf foot.
      { key: "dividerY", expr: expr("ground_elevation_mm + 60 + lowerSectionHeight + 100") },
      { key: "lowerBandBottom", expr: expr("ground_elevation_mm + 90") },
      { key: "upperBandBottom", expr: expr("ground_elevation_mm + 60 + lowerSectionHeight + 160") },
    ],

    parts: [
      // === MATERIAL ===========================================================
      // Sloupek L 50×50 — the leaf frame: 3 vertical stiles (A) + 4 horizontal
      // rails (B, top+bottom of each leaf). Origin: left opening edge at the
      // datum, X across the opening, Y up.
      {
        path: "frame.lprofile",
        resolve: {
          role: "frame.l_profile",
          section: expr('"L50x50"'),
          material: expr('"alu"'),
        },
        name: "Sloupek L 50×50",
        bom: {
          unit: "meter",
          lengthMm: expr("lProfileTotalMm"),
          quantity: expr("roundUp(lProfileTotalMm / 1000)"),
          category: "material",
        },
        geometry: [
          // 3 stiles (A): left-outer, left-inner, right-outer. The right-inner
          // stile is the T astragal (frame.tpost/centerStile).
          {
            key: "stileLeftOuter",
            length: expr("frameInnerHeight"),
            at: [expr("leftLeafX"), expr("leafBottomY"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
          },
          {
            key: "stileLeftInner",
            length: expr("frameInnerHeight"),
            at: [expr("leftLeafX + leafWidth"), expr("leafBottomY"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
          },
          {
            key: "stileRightOuter",
            length: expr("frameInnerHeight"),
            at: [expr("rightLeafX + leafWidth"), expr("leafBottomY"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
          },
          // 4 rails (B): bottom + top chord of each leaf, spanning the leaf width.
          {
            key: "railLeftBottom",
            length: expr("leafWidth"),
            at: [expr("leftLeafX"), expr("leafBottomY"), expr("0")],
          },
          {
            key: "railLeftTop",
            length: expr("leafWidth"),
            at: [expr("leftLeafX"), expr("leafTopY"), expr("0")],
          },
          {
            key: "railRightBottom",
            length: expr("leafWidth"),
            at: [expr("rightLeafX"), expr("leafBottomY"), expr("0")],
          },
          {
            key: "railRightTop",
            length: expr("leafWidth"),
            at: [expr("rightLeafX"), expr("leafTopY"), expr("0")],
          },
        ],
      },
      // Sloupek T 50×50 — the centre meeting astragal (C, 1× full-height at the
      // right leaf's inner edge, running to the ground where the drop-bolt seats)
      // + the two sDP divider crossbars (D, 1 per leaf).
      {
        path: "frame.tpost",
        resolve: {
          role: "frame.t_post",
          section: expr('"T50x50"'),
          material: expr('"alu"'),
        },
        name: "Sloupek T 50×50",
        bom: {
          unit: "meter",
          lengthMm: expr("tProfileTotalMm"),
          quantity: expr("roundUp(tProfileTotalMm / 1000)"),
          category: "material",
        },
        geometry: [
          {
            key: "centerStile",
            length: expr("centerStileHeight"),
            at: [expr("rightLeafX"), expr("ground_elevation_mm"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
          },
          {
            key: "dividerRail",
            length: expr("dividerRailLength"),
            at: [expr("if(i == 0, leftLeafX, rightLeafX) + 50"), expr("dividerY"), expr("0")],
            repeat: { count: expr("2"), var: "i" },
          },
        ],
      },
      // h-profil 50 — the vertical infill carriers: 2 per section per leaf (4
      // upper @ upperSectionHeight, 4 lower @ lowerSectionHeight).
      {
        path: "frame.hprofile",
        resolve: {
          role: "frame.h_profile",
          section: expr('"h50"'),
          material: expr('"alu"'),
        },
        name: "h-profil 50",
        bom: {
          unit: "meter",
          lengthMm: expr("hProfileTotalMm"),
          quantity: expr("roundUp(hProfileTotalMm / 1000)"),
          category: "material",
        },
        geometry: [
          {
            key: "upright_upper",
            length: expr("upperSectionHeight"),
            at: [
              expr("if(i < 2, leftLeafX, rightLeafX) + if(i % 2 == 0, 300, leafWidth - 300)"),
              expr("upperBandBottom"),
              expr("0"),
            ],
            rotation: [expr("0"), expr("0"), expr("90")],
            repeat: { count: expr("4"), var: "i" },
          },
          {
            key: "upright_lower",
            length: expr("lowerSectionHeight"),
            at: [
              expr("if(i < 2, leftLeafX, rightLeafX) + if(i % 2 == 0, 300, leafWidth - 300)"),
              expr("lowerBandBottom"),
              expr("0"),
            ],
            rotation: [expr("0"), expr("0"), expr("90")],
            repeat: { count: expr("4"), var: "i" },
          },
        ],
      },
      // Výplň — the horizontal infill planks. Both leaves stack the same rows, so
      // the piece count is 2 × (upper + lower) per-leaf. Upper band seats off the
      // divider (upperBandBottom + upperFillOffset1, stepping by upperFillPitch);
      // lower band off the leaf foot (lowerBandBottom + lowerFillOffset1).
      {
        path: "fill.material",
        resolve: {
          role: "fill",
          section: expr("fill.section_code"),
          material: expr('"alu"'),
        },
        name: "Výplň",
        bom: {
          unit: "meter",
          lengthMm: expr("fillTotalMm"),
          quantity: expr("roundUp(fillTotalMm / 1000)"),
          category: "material",
        },
        geometry: [
          {
            key: "plank_upper",
            length: expr("plankLength"),
            at: [
              expr("if(i < upperFillCount, leftLeafX, rightLeafX) + 65"),
              expr("upperBandBottom + upperFillOffset1 + (i % upperFillCount) * upperFillPitch"),
              expr("0"),
            ],
            repeat: { count: expr("2 * upperFillCount"), var: "i" },
          },
          {
            key: "plank_lower",
            length: expr("plankLength"),
            at: [
              expr("if(i < lowerFillCount, leftLeafX, rightLeafX) + 65"),
              expr("lowerBandBottom + lowerFillOffset1 + (i % lowerFillCount) * lowerFillPitch"),
              expr("0"),
            ],
            repeat: { count: expr("2 * lowerFillCount"), var: "i" },
          },
        ],
      },
      // Sloup 100×100 — the two hinge posts (F), at the opening edges.
      {
        path: "frame.post",
        resolve: {
          role: "frame.post",
          section: expr('"jakl_100x100"'),
          material: expr('"alu"'),
        },
        name: "Sloup 100×100",
        bom: {
          unit: "meter",
          lengthMm: expr("postTotalMm"),
          quantity: expr("roundUp(postTotalMm / 1000)"),
          category: "material",
        },
        geometry: [
          {
            key: "post",
            length: expr("postHeight"),
            at: [expr("i * opening_width_mm"), expr("ground_elevation_mm"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
            repeat: { count: expr("2"), var: "i" },
          },
        ],
      },

      // === ACCESSORIES / HARDWARE =============================================
      {
        path: "hardware.limiter",
        resolve: { role: "hardware.limiter" },
        name: "Limit S",
        bom: { unit: "piece", quantity: expr("1"), category: "accessory" },
      },
      {
        path: "hardware.latch",
        resolve: { role: "hardware.latch" },
        name: "Zástrč",
        bom: { unit: "piece", quantity: expr("1"), category: "accessory" },
      },
      {
        path: "frame.kit",
        resolve: { role: "frame.kit.bolted" },
        name: "Sada k rámu (šroubovaná)",
        // Two sets — one per leaf (Excel T28 = 2).
        bom: { unit: "set", quantity: expr("2"), category: "accessory" },
      },
      {
        path: "hardware.handle",
        resolve: { role: "hardware.handle" },
        name: "Kování klika/koule",
        bom: { unit: "piece", quantity: expr("1"), category: "accessory" },
      },
      {
        path: "hardware.hinge",
        resolve: { role: "hardware.hinge" },
        name: "Sada pant",
        // Four hinges — two per leaf (Excel T30 = 4; H25 "PANT 4 × velký").
        bom: { unit: "piece", quantity: expr("4"), category: "accessory" },
      },
      {
        path: "fill.connectors",
        resolve: { role: "fill.connector" },
        name: "Spojovák výplně",
        bom: { unit: "piece", quantity: expr("spojovakCount"), category: "accessory" },
      },

      // === MANUFACTURING ======================================================
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

      // === INSTALLATION =======================================================
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

  terrain: { elevationParam: "ground_elevation_mm" },

  // Generated UI (CORE_SPEC §8): the wizard structure ships WITH the model.
  ui: {
    steps: [
      {
        id: "rozmery",
        label: "Rozměry",
        groups: [
          { id: "otvor", label: "Otvor", params: ["opening_width_mm", "clear_height_mm"] },
          { id: "teren", label: "Terén", params: ["ground_elevation_mm"] },
        ],
      },
      {
        id: "konstrukce",
        label: "Konstrukce",
        groups: [{ id: "vypln", label: "Výplň", params: ["fill_type_id"] }],
      },
      {
        id: "vybava",
        label: "Výbava a práce",
        groups: [
          {
            id: "prace",
            label: "Práce",
            params: ["manufacturing_hours", "include_installation"],
          },
        ],
      },
    ],
  },

  // I2 delta-0 fixture (CORE_SPEC §1) — the Excel U34 anchor (55843.4). The
  // exhaustive priced corpus lives in `golden/swing-gate.ts`; this travels WITH
  // the release into the immutable store and is what the publish gate executes
  // (derived-only — checkFixtures runs it price-free).
  fixtures: [
    {
      name: "PLAŇKA 120 3D · two-leaf divided on-posts · 3.0 × 1.5 m (Excel U34 delta-0)",
      anchored: true,
      config: {
        opening_width_mm: 3000,
        clear_height_mm: 1500,
        fill_type_id: "planka_120_3d",
        ground_elevation_mm: 0,
        manufacturing_hours: 20,
        include_installation: true,
      },
      expected: {
        derived: {
          frameInnerHeight: 1400,
          leafWidth: 1465,
          centerStileHeight: 1470,
          dividerRailLength: 1365,
          plankLength: 1335,
          postHeight: 1510,
          usableInfillHeight: 1238,
          upperSectionHeight: 823,
          lowerSectionHeight: 415,
          upperFillCount: 6,
          upperFillPitch: 122,
          upperFillOffset1: 76,
          lowerFillCount: 3,
          lowerFillPitch: 122,
          lowerFillOffset1: 55,
          plankCount: 18,
        },
        totalPrice: 55843.4,
      },
    },
  ],
};
