/**
 * `fence-run@1` — the FIL `Ploty` fence calculator transcribed into DATA
 * (CORE_SPEC §3), the third real product family. Ground truth:
 * `~/gates/reference_files_unlocked/2026-PC_Ploty_FINAL_PC.xlsx` (`Kalkulace` +
 * `Výplet` sheets, FORMULAS not cached values). The generic @repo/engine derives
 * BOM + geometry + price from this release alone; the numbers are byte-true to
 * the Excel member chain (see `fence-run.spacing.test.ts` / `golden/fence-run.ts`).
 *
 * A `fence-run@1` instance is ONE uniform run of `fieldCount` identical bays
 * between `fieldCount + 1` posts (the Excel's per-field "Pole" block, with its
 * `počet polí` count). The SITE composes several runs — different bay widths /
 * heights on stepped terrain — sharing boundary posts (the shared-post rule,
 * I6). The Excel's up-to-7 "different fields" are exactly that: several runs on
 * one site, not one release with heterogeneous bays.
 *
 * MODEL vs the Excel input shape: the estimator's manual sheet takes a per-bay
 * clear width (`světlá šířka`) + count (`počet polí`); the site-drawn perimetra
 * fence takes a `run_length_mm` and DERIVES the bay subdivision (`fieldCount =
 * roundUp(run_length / 2500)`, `fieldWidth = run_length / fieldCount`). The FIL
 * per-bay FORMULAS then drive everything off the derived `fieldWidth`, so a run
 * of N equal bays reproduces N copies of one "Pole" byte-for-byte.
 *
 * Per-bay member chain (`Kalkulace`, Pole block, `pref. mezera` = 0):
 *   A  h-profil  (E26 = 4·count vertical carriers; F26 = the fill-zone height)
 *   B  Výplň     (E27 = K32·count horizontal lamellas; F27 = clear_width − 70)
 *   C  Sloup 100 (E28 = count + 1 posts for a single run; F28 = clear_height)
 * then caps (roof + Sloup), footing (Patka), fill connector (Spojovák), and the
 * two FLAT per-field labour lines (Výroba 500/field, Montáž 650/field — NOT
 * hours × rate; that is the gate families' model). The Excel `Výplet` fill
 * spacing (K32/J33/F26) is the SHARED ADR-0098 chain, fed the raw `clear_height`
 * (the fence divides by the clear height directly; the h-profil length is the
 * chain's OUTPUT `fillZoneHeight`, not an input) with the `Ploty` Výplet numbers
 * (product-specific end-offsets — the Branky/Samonosna sheets differ, so these
 * are NOT copied from the gate families).
 *
 * Terrain (CORE_SPEC §5): `ground_elevation_mm` is the declared elevation param —
 * a placement's stepped-terrain segment drives it through the input gate. The
 * connection rule `fence.connection.top_step` is the model's stepped-vs-invalid
 * judgment: neighbouring top lines may step at most 200 mm.
 *
 * DEFERRED (FIL follow-ups, documented not invented): the `pref. mezera`
 * preferred-gap input (Excel F23 — switches the spacing divisor to
 * `max_overlap + gap`; all real configs use 0) and the "no posts / masonry"
 * (`T186 ≠ 2`) variant. The shared-post rule shares the post PROFILE metres but
 * not its caps/footing (a connected boundary double-counts one cap set per
 * shared post) — the byte-true STANDALONE golden is unaffected; site cap-sharing
 * is a follow-up (CORE_SPEC §6 override territory).
 */
import { expr, type ProductModelRelease } from "@repo/model";

export const fenceRunV1: ProductModelRelease = {
  id: "fence-run@1",
  modelId: "fence-run",
  version: 1,
  status: "published",

  parameters: [
    {
      key: "run_length_mm",
      label: "Délka plotu",
      type: "length_mm",
      domain: { kind: "range", min: 1000, max: 30000 },
      adjustability: "user",
    },
    {
      key: "clear_height_mm",
      label: "Výška plotu",
      type: "length_mm",
      domain: { kind: "range", min: 800, max: 2000 },
      adjustability: "user",
      deviation: {
        mode: "warn",
        bounds: { min: expr("600"), max: expr("2200") },
        note: "outside catalog range — post embedment / wind load unverified",
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
      key: "frame_material",
      label: "Materiál rámu",
      type: "select",
      domain: { kind: "enum", values: ["alu", "steel"] },
      default: "alu",
      adjustability: "user",
    },
    {
      key: "include_installation",
      label: "Včetně montáže",
      type: "bool",
      default: true,
      adjustability: "user",
    },
  ],

  // The seven infill types — the `Ploty` `Výplet` sheet (product-specific: the
  // end-offsets / max-pitch differ from the Branky & Samonosna sheets, so these
  // numbers are the Ploty workbook's own, not shared with the gate families).
  // `min_spacing_mm` = "min. rozteč" (the count divisor); `max_spacing_mm` =
  // "max. rozteč" (the pitch cap, unless `disable_max_spacing` = "Vypnout max.?");
  // `end_offset_*` = "min. vzd. od konce 1/2"; `max_overlap_mm` = "max. překrytí"
  // (the I2 overlap guard). `dimension_type` selects the h-profil carrier (3D →
  // h-50, 2D → h-25, the Excel P19 switch).
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
            section_code: "lamela_113",
            min_spacing_mm: 90,
            max_spacing_mm: 160,
            max_overlap_mm: 104,
            end_offset_1_mm: 43,
            end_offset_2_mm: 64,
            disable_max_spacing: false,
          },
        },
        {
          id: "lamela_120_3d",
          label: "Lamela 120 3D",
          attrs: {
            profile_mm: 120,
            dimension_type: "3D",
            section_code: "lamela_120",
            min_spacing_mm: 90,
            max_spacing_mm: 160,
            max_overlap_mm: 113,
            end_offset_1_mm: 24,
            end_offset_2_mm: 90,
            disable_max_spacing: false,
          },
        },
        {
          id: "planka_120_3d",
          label: "PLAŇKA 120 3D",
          attrs: {
            profile_mm: 120,
            dimension_type: "3D",
            section_code: "planka_120",
            min_spacing_mm: 105,
            max_spacing_mm: 170,
            max_overlap_mm: 122,
            end_offset_1_mm: 31,
            end_offset_2_mm: 92,
            disable_max_spacing: false,
          },
        },
        {
          id: "lamela_113_2d",
          label: "Lamela 113 2D",
          attrs: {
            profile_mm: 113,
            dimension_type: "2D",
            section_code: "lamela_113",
            min_spacing_mm: 95,
            max_spacing_mm: 170,
            max_overlap_mm: 113,
            end_offset_1_mm: 48,
            end_offset_2_mm: 65,
            disable_max_spacing: true,
          },
        },
        {
          id: "planka_120_2d",
          label: "PLAŇKA 120 2D",
          attrs: {
            profile_mm: 120,
            dimension_type: "2D",
            section_code: "planka_120",
            min_spacing_mm: 121,
            max_spacing_mm: 180,
            max_overlap_mm: 121,
            end_offset_1_mm: 30,
            end_offset_2_mm: 90,
            disable_max_spacing: true,
          },
        },
        {
          id: "planka_100_3d",
          label: "PLAŇKA 100 3D",
          attrs: {
            profile_mm: 100,
            dimension_type: "3D",
            section_code: "planka_100",
            min_spacing_mm: 88,
            max_spacing_mm: 142,
            max_overlap_mm: 102,
            end_offset_1_mm: 26,
            end_offset_2_mm: 77,
            disable_max_spacing: false,
          },
        },
        {
          id: "planka_100_2d",
          label: "PLAŇKA 100 2D",
          attrs: {
            profile_mm: 100,
            dimension_type: "2D",
            section_code: "planka_100",
            min_spacing_mm: 101,
            max_spacing_mm: 150,
            max_overlap_mm: 101,
            end_offset_1_mm: 25,
            end_offset_2_mm: 75,
            disable_max_spacing: true,
          },
        },
      ],
    },
  ],

  constraints: [
    {
      key: "fence.run.long",
      kind: "range",
      expr: expr("run_length_mm <= 20000"),
      severity: "warn",
      scope: "instance",
    },
    // ADR 0098 overlap guard (Excel `max. překrytí`): at the tightest (min-spacing)
    // pitch the slat overlap is `profile − min_spacing`; the authored fill must not
    // overlap more than its allowed maximum. Attr-only (evaluated pre-derivation).
    {
      key: "fence.fill.overlap_within_max",
      kind: "range",
      expr: expr("fill.profile_mm - fill.min_spacing_mm <= fill.max_overlap_mm"),
      severity: "warn",
      scope: "instance",
    },
    // The stepped-terrain judgment (CORE_SPEC §5): neighbouring top lines may
    // step ≤ 200 mm; a bigger step needs a different model, not this fence.
    {
      key: "fence.connection.top_step",
      kind: "expr",
      expr: expr("abs(self.topLine - other.topLine) <= 200"),
      severity: "error",
      scope: "connection",
    },
  ],

  derivation: {
    derived: [
      // Bay subdivision: a site-drawn run of length `run_length_mm` splits into
      // equal bays no wider than 2500 mm (the FIL-typical max bay; FIL-confirm
      // pending). Each bay then IS an Excel "Pole" of width `fieldWidth`.
      { key: "fieldCount", expr: expr("roundUp(run_length_mm / 2500)") },
      { key: "innerPostCount", expr: expr("fieldCount - 1") },
      { key: "fieldWidth", expr: expr("run_length_mm / fieldCount") },
      { key: "postCount", expr: expr("fieldCount + 1") },
      // Mirror for the drawing's overall-width dimension (a `derivedValue` must
      // name a derived key, not a raw param).
      { key: "runLength", expr: expr("run_length_mm") },
      { key: "postLength", expr: expr("clear_height_mm") },
      // Excel F27: the horizontal lamella spans the bay minus 70 (35 inset each side).
      { key: "lamellaLength", expr: expr("fieldWidth - 70") },
      // The site reference plane (CORE_SPEC §5): a connected neighbour reads
      // `other.topLine`; two runs may step ≤ 200 mm.
      { key: "topLine", expr: expr("ground_elevation_mm + clear_height_mm") },

      // --- Shared ADR-0098 Výplet spacing (Excel `Kalkulace` K32/H33/I33/J33) ---
      // The fence divides by the RAW clear height (not a reduced carrier length —
      // that is the branka/gate difference); the carrier length `fillZoneHeight`
      // is the chain's OUTPUT (Excel F26 = konce1 + gaps·pitch + konce2).
      // K32 (count): floor(clear_height / min_spacing) − 1 (the Excel −K181 term).
      { key: "fillCount", expr: expr("floor(clear_height_mm / fill.min_spacing_mm) - 1") },
      // gaps = count − 1, guarded ≥ 1 so a 1-slat fill can't divide by zero (I33).
      { key: "fillGaps", expr: expr("max(fillCount - 1, 1)") },
      // Raw even pitch over the clear height minus both end margins (J33 inner).
      {
        key: "fillRawPitch",
        expr: expr(
          "floor((clear_height_mm - fill.end_offset_1_mm - fill.end_offset_2_mm) / fillGaps)",
        ),
      },
      // Cap at max_spacing unless the fill disables the max (Excel J33 `Vypnout max?`).
      {
        key: "fillPitch",
        expr: expr(
          "if(fill.disable_max_spacing, fillRawPitch, min(fillRawPitch, fill.max_spacing_mm))",
        ),
      },
      // Excel F26 — the fill-zone height = the h-profil carrier length.
      {
        key: "fillZoneHeight",
        expr: expr("fill.end_offset_1_mm + fillGaps * fillPitch + fill.end_offset_2_mm"),
      },
      // Excel N33 — the carrier centred in the clear height (ROUNDDOWN bottom margin).
      { key: "fillBottomMargin", expr: expr("floor((clear_height_mm - fillZoneHeight) / 2)") },

      // Roll-up counts (Excel E26 / E27) — the h-profil carriers (4 per bay) and
      // lamellas (count per bay), used by both the BOM and the geometry.
      { key: "hProfileTotal", expr: expr("4 * fieldCount") },
      { key: "lamellaTotal", expr: expr("fillCount * fieldCount") },
    ],

    parts: [
      // --- MATERIAL: posts (Sloup 100, per-metre; split for the shared-post rule) --
      {
        path: "posts.start",
        resolve: {
          role: "fence.post",
          section: expr('"jakl_100x100"'),
          material: expr("frame_material"),
        },
        name: "Sloup krajní (začátek)",
        // Excel T21 sums every post's metres then rounds — the split parts round
        // per-post, which coincides with the summed rounding for whole-metre
        // heights (the byte-true golden). A connected neighbour consumes this post.
        bom: {
          unit: "meter",
          quantity: expr("roundUp(clear_height_mm / 1000)"),
          lengthMm: expr("clear_height_mm"),
          category: "material",
        },
        geometry: [
          {
            key: "post",
            length: expr("postLength"),
            at: [expr("0"), expr("ground_elevation_mm"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
          },
        ],
      },
      {
        path: "posts.end",
        resolve: {
          role: "fence.post",
          section: expr('"jakl_100x100"'),
          material: expr("frame_material"),
        },
        name: "Sloup krajní (konec)",
        bom: {
          unit: "meter",
          quantity: expr("roundUp(clear_height_mm / 1000)"),
          lengthMm: expr("clear_height_mm"),
          category: "material",
        },
        geometry: [
          {
            key: "post",
            length: expr("postLength"),
            at: [expr("run_length_mm"), expr("ground_elevation_mm"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
          },
        ],
      },
      {
        path: "posts.line",
        resolve: {
          role: "fence.post",
          section: expr('"jakl_100x100"'),
          material: expr("frame_material"),
        },
        name: "Sloup průběžný",
        when: expr("fieldCount > 1"),
        bom: {
          unit: "meter",
          quantity: expr("innerPostCount * roundUp(clear_height_mm / 1000)"),
          lengthMm: expr("innerPostCount * clear_height_mm"),
          category: "material",
        },
        geometry: [
          {
            key: "post",
            length: expr("postLength"),
            at: [expr("(i + 1) * fieldWidth"), expr("ground_elevation_mm"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
            repeat: { count: expr("innerPostCount"), var: "i" },
          },
        ],
      },
      // --- MATERIAL: h-profil fill carriers (4 per bay, 3D → h-50 / 2D → h-25) ----
      {
        path: "frame.hprofile",
        resolve: {
          role: "frame.h_profile",
          section: expr('if(fill.dimension_type == "2D", "h25", "h50")'),
          material: expr("frame_material"),
        },
        name: "h-profil",
        // Excel E26 = 4·count carriers, each the fill-zone height (F26).
        bom: {
          unit: "meter",
          quantity: expr("roundUp(hProfileTotal * fillZoneHeight / 1000)"),
          lengthMm: expr("hProfileTotal * fillZoneHeight"),
          category: "material",
        },
        // Four vertical carriers per bay, evenly spanning the lamella width (35 mm
        // inset each side) — the horizontal lamellas seat into them; a 2 m bay
        // needs the intermediate supports (Excel bills 4/bay). The two OUTER
        // carriers register at the bay edges, i.e. within the 100 mm post footprint
        // (the h-profil channel is mounted on the post face) — intentional, not a
        // floating overlap; the two inner carriers stand free in the bay.
        geometry: [
          {
            key: "carrier",
            length: expr("fillZoneHeight"),
            at: [
              expr("floor(i / 4) * fieldWidth + 35 + (i % 4) * (lamellaLength / 3)"),
              expr("ground_elevation_mm + fillBottomMargin"),
              expr("0"),
            ],
            rotation: [expr("0"), expr("0"), expr("90")],
            repeat: { count: expr("hProfileTotal"), var: "i" },
          },
        ],
      },
      // --- MATERIAL: the horizontal lamella / planka fill -------------------------
      {
        path: "fill.material",
        resolve: {
          role: "fill",
          section: expr("fill.section_code"),
          material: expr("frame_material"),
        },
        name: "Výplň",
        // Excel E27 = K32·count lamellas, each clear_width − 70 (F27).
        bom: {
          unit: "meter",
          quantity: expr("roundUp(lamellaTotal * lamellaLength / 1000)"),
          lengthMm: expr("lamellaTotal * lamellaLength"),
          category: "material",
        },
        // ADR 0098 spacing: lamella `row` sits `end_offset_1` above the carrier
        // foot (centred by `fillBottomMargin`), stepping by the real `fillPitch`.
        geometry: [
          {
            key: "piece",
            length: expr("lamellaLength"),
            at: [
              expr("floor(i / fillCount) * fieldWidth + 35"),
              expr(
                "ground_elevation_mm + fillBottomMargin + fill.end_offset_1_mm" +
                  " + (i % fillCount) * fillPitch",
              ),
              expr("0"),
            ],
            repeat: { count: expr("lamellaTotal"), var: "i" },
          },
        ],
      },

      // --- ACCESSORIES (BOM-only) ------------------------------------------------
      {
        path: "caps.roof",
        resolve: { role: "fence.cap.roof" },
        name: "Krytka roof",
        // Excel P22 (T22 = post count): one roof cap per post.
        bom: { unit: "piece", quantity: expr("postCount"), category: "accessory" },
      },
      {
        path: "caps.post",
        resolve: { role: "fence.cap.post" },
        name: "Krytka Sloup 100",
        // Excel P29 (T29 = post count).
        bom: { unit: "piece", quantity: expr("postCount"), category: "accessory" },
      },
      {
        path: "caps.hprofile",
        resolve: { role: "fence.cap.hprofile" },
        name: "Krytka h-profil",
        // Excel P28 (T28 = h-profil count / 2).
        bom: { unit: "piece", quantity: expr("hProfileTotal / 2"), category: "accessory" },
      },
      {
        path: "footings",
        resolve: { role: "fence.footing" },
        name: "Patka Sloup",
        // Excel P30 (T30 = post count): one footing per post.
        bom: { unit: "piece", quantity: expr("postCount"), category: "accessory" },
      },
      {
        path: "fill.connectors",
        resolve: { role: "fill.connector" },
        name: "Spojovák výplně",
        // Excel P31 (T31 = lamella count): one connector per lamella.
        bom: { unit: "piece", quantity: expr("lamellaTotal"), category: "accessory" },
      },

      // --- MANUFACTURING: flat per field (Excel S32 = 500/field, T32 = field count) --
      {
        path: "labor.manufacturing",
        resolve: { role: "fence.manufacturing" },
        name: "Výroba",
        bom: { unit: "piece", quantity: expr("fieldCount"), category: "manufacturing" },
      },

      // --- INSTALLATION: flat per field (Excel S33 = 650/field) -------------------
      {
        path: "labor.installation",
        resolve: { role: "fence.installation" },
        name: "Montáž",
        when: expr("include_installation"),
        bom: { unit: "piece", quantity: expr("fieldCount"), category: "installation" },
      },
    ],
  },

  ports: [
    {
      id: "start",
      kind: "fence.start",
      compatibleKinds: ["fence.end", "gate.side"],
      sharing: { element: "posts.start", policy: "consumer" },
      anchor: { at: [expr("0"), expr("ground_elevation_mm"), expr("0")] },
    },
    {
      id: "end",
      kind: "fence.end",
      compatibleKinds: ["fence.start", "gate.side"],
      sharing: { element: "posts.end", policy: "owner" },
      anchor: { at: [expr("run_length_mm"), expr("ground_elevation_mm"), expr("0")] },
    },
  ],

  terrain: { elevationParam: "ground_elevation_mm" },

  // Drawing-rule spec (ADR 0102): the front elevation's feature-bound dimensions
  // + Excel member letters, each printing a DERIVED key (Excel fidelity). Plus a
  // section A–A across the first bay centre showing the stacked lamella cuts.
  drawing: {
    views: [{ id: "front", projection: "front" }],
    rules: [
      {
        kind: "dimension",
        id: "overall.width",
        label: "Celková šířka",
        feature: { pieces: "posts.*" },
        measure: "x-extent",
        side: "bottom",
        derivedValue: "runLength",
      },
      {
        kind: "dimension",
        id: "overall.height",
        label: "Celková výška",
        feature: { pieces: "posts.start/post" },
        measure: "y-extent",
        side: "left",
        derivedValue: "postLength",
      },
      {
        kind: "dimension",
        id: "fill.length",
        label: "Délka výplně",
        feature: { pieces: "fill.material/piece[0]" },
        measure: "x-extent",
        side: "top",
        derivedValue: "lamellaLength",
      },
      {
        kind: "chain",
        id: "fill.pitch",
        label: "Rozteč výplně",
        feature: { pieces: "fill.material/piece[*]" },
        measure: "y-extent",
        side: "left",
        derivedValue: "fillPitch",
      },
      {
        kind: "label",
        id: "member.A",
        feature: { pieces: "frame.hprofile/carrier[0]" },
        text: "A",
      },
      { kind: "label", id: "member.B", feature: { pieces: "fill.material/piece[0]" }, text: "B" },
      { kind: "label", id: "member.C", feature: { pieces: "posts.start/post" }, text: "C" },
    ],
    // Section A–A: a vertical plane across the first bay's centre (x = 1000 for the
    // golden's 2000 mm bay). It misses every upright (posts at bay edges, h-profil
    // carriers at discrete x) and cuts the horizontal lamellas transversely →
    // stacked cross-sections (flat planka → honest degraded outlines, I5).
    sections: [{ id: "A-A", axis: "x", offsetMm: 1000 }],
  },

  ui: {
    steps: [
      {
        id: "rozmery",
        label: "Rozměry",
        groups: [
          { id: "plot", label: "Plot", params: ["run_length_mm", "clear_height_mm"] },
          { id: "teren", label: "Terén", params: ["ground_elevation_mm"] },
        ],
      },
      {
        id: "provedeni",
        label: "Provedení",
        groups: [{ id: "material", label: "Materiál", params: ["frame_material", "fill_type_id"] }],
      },
      {
        id: "prace",
        label: "Práce",
        groups: [{ id: "prace", label: "Práce", params: ["include_installation"] }],
      },
    ],
  },

  // I2 fixture (CORE_SPEC §1) — the byte-true GEOMETRY anchor (Excel `Ploty`
  // Kalkulace Pole formulas, LAMELA 113 3D, bay 2000 × 2000). The publish gate
  // executes this derived-only; it travels with the release (immutable). The
  // full priced golden lives in `golden/fence-run.ts`.
  fixtures: [
    {
      name: "LAMELA 113 3D · bay 2000 × 2000 (Excel Ploty Pole geometry)",
      anchored: true,
      config: {
        run_length_mm: 8000,
        clear_height_mm: 2000,
        fill_type_id: "lamela_113_3d",
        frame_material: "alu",
        include_installation: true,
      },
      expected: {
        derived: {
          fieldCount: 4,
          innerPostCount: 3,
          fieldWidth: 2000,
          postCount: 5,
          lamellaLength: 1930,
          fillCount: 21,
          fillGaps: 20,
          fillRawPitch: 94,
          fillPitch: 94,
          fillZoneHeight: 1987,
          fillBottomMargin: 6,
          hProfileTotal: 16,
          lamellaTotal: 84,
          topLine: 2000,
        },
      },
    },
  ],
};
