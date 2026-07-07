/**
 * `sliding-gate@1` — the MVP cantilever sliding-gate calculator transcribed
 * into DATA (CORE_SPEC §3). This is the founding proof that product knowledge
 * is interpretable data, not code: the generic @repo/engine derives BOM + price
 * from this release alone, byte-identical to the MVP's Excel-anchored goldens
 * (I1/I2 — see sliding-gate.delta0.test.ts).
 *
 * Dimension chain provenance (MVP calc-engine / unlocked 2026 Kalkulace sheet):
 *   frameHeight = clear_height − 40 ; postA = frameHeight − 140 ; postB = postA − 100
 *   diagonal    = round((postA − 50) / sin(angle))
 *   railLength  = opening × (2-panel 3D ? 1.4 : 1.333)
 *   hProfile    = postA − 115 ; fillCount = floor(hProfile / min_spacing)
 *
 * Step 2: every part resolves through the catalog via {role, section, material}
 * (CORE_SPEC §2) — the slice-1 componentCode bridge is gone. `frame_material`
 * switches the whole frame+fill between aluminum and steel against the same
 * recipe (multi-material), and the ENZO rail is two real SKUs priced from the
 * price table, not a hardcoded CZK ternary (price truth).
 *
 * Range/enum input rules live on parameter `domain`s — the engine's input gate
 * (I7) enforces them; constraints carry only the judgment calls (warn limits).
 *
 * Step 4 (site graph): `ground_elevation_mm` (terrain-driven, default 0 — the
 * standalone goldens are untouched), the `topLine` reference plane fence
 * connection rules read via `other.*`, and two `gate.side` ports that OWN the
 * tower post — a fence run attaching to the gate consumes its own end post
 * and bolts to the tower post (I6).
 *
 * Step 5 (renderers): piece geometry on the structural material parts. The
 * MVP's rolled-up BOM lines stay untouched (delta-0); geometry tells the
 * OTHER truth — `frame.lprofile` bills meters but cuts five distinct pieces
 * (postA, postB, the suspension diagonal with its mitre cut, bottom member,
 * slide rail). Origin: left outer-frame edge at the site datum, X across the
 * opening, Y up. Accessories (motor, kits, rollers) are BOM-only in v1 —
 * geometry lands per part when a drawing needs it, never invented wholesale.
 */
import { expr, type ProductModelRelease } from "@repo/model";

export const slidingGateV1: ProductModelRelease = {
  id: "sliding-gate@1",
  modelId: "sliding-gate",
  version: 1,
  status: "published",

  parameters: [
    {
      key: "opening_width_mm",
      label: "Šířka otvoru",
      type: "length_mm",
      domain: { kind: "range", min: 2000, max: 8000 },
      adjustability: "user",
      // The "but not there" knowledge (CORE_SPEC §3): a quote may deviate
      // outside the catalog range with a recorded reason, never past bounds.
      // Placeholder envelope — real values are a fabricator-extraction item.
      deviation: {
        mode: "warn",
        bounds: { min: expr("1800"), max: expr("9000") },
        note: "outside catalog range — track/cantilever stability unverified",
      },
    },
    {
      key: "clear_height_mm",
      label: "Průjezdná výška",
      type: "length_mm",
      domain: { kind: "range", min: 800, max: 2500 },
      adjustability: "user",
      // Hard structural limit: the dimension chain (frameHeight − 40 …) and
      // wind load make this non-negotiable. Placeholder envelope, as above.
      deviation: {
        mode: "hard",
        bounds: { min: expr("600"), max: expr("2600") },
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
    {
      key: "suspension_angle",
      label: "Úhel závěsu",
      type: "int",
      domain: { kind: "enum", values: ["35", "40", "45"] },
      adjustability: "user",
    },
    {
      key: "panel_count",
      label: "Počet polí",
      type: "int",
      domain: { kind: "enum", values: ["2", "3"] },
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
      key: "opening_direction",
      label: "Směr otevírání",
      type: "select",
      domain: { kind: "enum", values: ["left", "right"] },
      adjustability: "user",
    },
    {
      key: "include_motor",
      label: "Včetně pohonu",
      type: "bool",
      default: true,
      adjustability: "user",
    },
    {
      key: "include_installation",
      label: "Včetně montáže",
      type: "bool",
      default: true,
      adjustability: "user",
    },
    {
      key: "manufacturing_hours",
      label: "Hodiny výroby",
      type: "int",
      // Estimator-editable (CORE_SPEC §3); defaults to the price-table multiplier
      // as a per-size estimate when the estimator leaves it blank (MVP rule).
      defaultExpr: expr("price.manufacturing_multiplier"),
      adjustability: "tenant",
    },
  ],

  // The seven cantilever Výplet (infill) types, transcribed from the 2026 Excel
  // `Výplet` sheet (`~/gates/reference_files_unlocked/2026-PC_Samonosna_brana…`)
  // — the SAME data the gates-MVP `fillType` seed carries (both ground truths
  // agree cell-for-cell). `min_spacing_mm` drives the unified 2026 fill count
  // (`floor((postA−115) / min_spacing)`); `dimension_type` selects the 2-panel
  // rail multiplier (3D ⇒ 1.4, 2D ⇒ 1.333). The placement attrs
  // (`end_offset_*`, `max_spacing_mm`, `disable_max_spacing`) are now consumed by
  // the real Výplet spacing engine (ADR 0098 — the `fill*` derived keys + the
  // fill `at.y`, the Excel `Kalkulace` placement math); `max_overlap_mm` is the
  // I2 data guard (`sliding.fill.overlap_within_max`). JAKL 20/20 is deliberately
  // deferred (manual count + a distinct tube-spacing branch). Profile→component:
  // the 2D/3D pair of one physical profile resolves to ONE catalog component at
  // ONE price/m (Excel shows identical `cena/m` for each pair), so lamela_113
  // and planka_100 each serve both their 2D and 3D options.
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
      key: "sliding.opening_width.wide",
      kind: "range",
      expr: expr("opening_width_mm <= 6000"),
      severity: "warn",
      scope: "instance",
    },
    {
      key: "sliding.clear_height.tall",
      kind: "range",
      expr: expr("clear_height_mm <= 2000"),
      severity: "warn",
      scope: "instance",
    },
    // ADR 0098: the Výplet `max_overlap_mm` guard (Excel `max. překrytí`). At the
    // tightest (min-spacing) pitch the slat overlap is `profile − min_spacing`;
    // the authored fill data must not overlap more than its allowed maximum. Attr-
    // only (instance constraints evaluate pre-derivation, so no `fill*` derived
    // keys here) — the actual distributed pitch is ≥ min_spacing, so this min-pitch
    // bound is conservative.
    {
      key: "sliding.fill.overlap_within_max",
      kind: "range",
      expr: expr("fill.profile_mm - fill.min_spacing_mm <= fill.max_overlap_mm"),
      severity: "warn",
      scope: "instance",
    },
  ],

  derivation: {
    derived: [
      { key: "frameHeight", expr: expr("clear_height_mm - 40") },
      { key: "postA", expr: expr("frameHeight - 140") },
      { key: "postB", expr: expr("postA - 100") },
      { key: "diagonal", expr: expr("round((postA - 50) / sinDeg(suspension_angle))") },
      { key: "outerFrameWidth", expr: expr("opening_width_mm + 200") },
      { key: "lMemberE", expr: expr("opening_width_mm + 700") },
      // 2-panel 3D fills use the 1.4 rail multiplier; everything else 1.333.
      {
        key: "railMultiplier",
        expr: expr('if(panel_count == 2 && fill.dimension_type != "2D", 1.4, 1.333)'),
      },
      { key: "railLength", expr: expr("opening_width_mm * railMultiplier") },
      { key: "bottomRail", expr: expr("lMemberE") },
      { key: "panelWidth", expr: expr("(opening_width_mm - 100) / panel_count") },
      { key: "hProfileLength", expr: expr("postA - 115") },
      {
        key: "fillPieceLength",
        expr: expr("(outerFrameWidth - (panel_count + 1) * 80) / panel_count + 20"),
      },
      { key: "fillCount", expr: expr("floor(hProfileLength / fill.min_spacing_mm)") },
      { key: "totalPieces", expr: expr("fillCount * panel_count") },
      // --- Real Výplet spacing (ADR 0098) — the Excel `Kalkulace` placement math,
      // consuming the slice-3 attrs that were authored-but-inert (ADR 0097). The
      // slat COUNT is still `floor(hProfileLength / min_spacing)` (unchanged — the
      // golden-locked count); these keys only redistribute that count across the
      // fill height with the real end-margins + pitch, so BOM/price are untouched.
      // gaps = count − 1 (guarded ≥ 1 so a 1-slat fill can't divide by zero).
      { key: "fillGaps", expr: expr("max(fillCount - 1, 1)") },
      // Raw even pitch: the count distributed over the height minus both end margins
      // (Excel J20: ROUNDDOWN((F32 − minC − minD) / gaps)).
      {
        key: "fillRawPitch",
        expr: expr(
          "floor((hProfileLength - fill.end_offset_1_mm - fill.end_offset_2_mm) / fillGaps)",
        ),
      },
      // Cap the pitch at max_spacing unless the fill disables the max (Excel J20's
      // `IF(Vypnout max?=FALSE, MIN(raw, maxF), raw)`) — this is what spreads the 2D
      // planks (disable_max) into a visible gap while 3D profiles stay tight.
      {
        key: "fillPitch",
        expr: expr(
          "if(fill.disable_max_spacing, fillRawPitch, min(fillRawPitch, fill.max_spacing_mm))",
        ),
      },
      // The floored-pitch leftover, re-centered between the two ends (Excel H20/K20:
      // offset1 gets ROUNDUP(rem/2), so the two end gaps differ by ≤ 1 mm).
      {
        key: "fillRemainder",
        expr: expr(
          "hProfileLength - fillGaps * fillPitch - fill.end_offset_1_mm - fill.end_offset_2_mm",
        ),
      },
      { key: "fillOffset1", expr: expr("fill.end_offset_1_mm + roundUp(fillRemainder / 2)") },
      { key: "railMeters", expr: expr("railLength / 1000") },
      // The site reference plane (step 4): what a connected neighbor's
      // connection constraints read as `other.topLine`.
      { key: "topLine", expr: expr("ground_elevation_mm + clear_height_mm") },
    ],

    parts: [
      // --- MATERIAL ---
      {
        path: "frame.lprofile",
        resolve: {
          role: "frame.l_profile",
          section: expr('"L50x50"'),
          material: expr("frame_material"),
        },
        name: "Sloupek L 50×50",
        bom: {
          unit: "meter",
          lengthMm: expr("postA + postB + diagonal + bottomRail + railLength"),
          quantity: expr("roundUp((postA + postB + diagonal + bottomRail + railLength) / 1000)"),
          category: "material",
        },
        geometry: [
          // A — front stile (leading edge), full frame height; the tallest leaf
          // member (postA = postB + 100). Foot sits on the bottom carrier F.
          {
            key: "postA",
            length: expr("postA"),
            at: [expr("0"), expr("ground_elevation_mm + 40"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
          },
          // C — rear stile (trailing edge), 100 mm shorter than A so its crown
          // tucks under the top rail E. The counterweight tail hangs off behind it.
          {
            key: "postB",
            length: expr("postB"),
            at: [expr("outerFrameWidth"), expr("ground_elevation_mm + 40"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
          },
          // E — top rail (Excel member E `Sloupek L`, len == the BOM's `bottomRail`
          // term = outerFrameWidth + 500): the leaf's top chord. Placed AT the
          // rear-stile / divider crown line (ground+40+postB) so every crown meets
          // it — its ABSENCE from the top is what left the crowns "attached to
          // nothing" (§3, Martin's NO-GO). Runs the full leaf width + the Excel
          // 500 mm overhang toward the tail. Was mis-authored at the bottom (key
          // "bottom"); relocated to the top — BOM length untouched (I4). Řez 17,5/45.
          {
            key: "topRail",
            length: expr("bottomRail"),
            at: [expr("0"), expr("ground_elevation_mm + 40 + postB"), expr("0")],
            cuts: { left: expr("17.5"), right: expr("45") },
          },
          // F — bottom carrier (Excel member F, len == railLength): the leaf's
          // bottom chord. Every stile/divider foot sits on it and it runs from the
          // front stile past the rear stile into the counterweight tail. Was key
          // "rail" (floated at z=60 with a free far end, role conflated with E);
          // now the in-plane bottom chord. Řez 90/45.
          {
            key: "bottomCarrier",
            length: expr("railLength"),
            at: [expr("0"), expr("ground_elevation_mm + 40"), expr("0")],
            cuts: { left: expr("90"), right: expr("45") },
          },
          // D — counterweight suspension diagonal: the tail's hypotenuse. From the
          // rear-stile crown it descends at the suspension angle OVER THE WALL to
          // the tail's rear-bottom corner on the ground track (Excel elevation; the
          // MVP + HEAD never drew the tail, so this 3D topology is DERIVED — CAR-18,
          // FIL photo deferred to fine-tuning). Was `180 + angle` (descending INTO
          // the leaf, bracing nothing — ADR 0095 only fixed the sky-ascent); now
          // `0 - angle` points +X / −Y so the far end lands over the wall at track
          // level (drop = diagonal·sin(angle) = postA − 50, angle-true). Řez 55/17,5.
          {
            key: "diagonal",
            length: expr("diagonal"),
            at: [expr("outerFrameWidth"), expr("ground_elevation_mm + 40 + postB"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("0 - suspension_angle")],
            cuts: { left: expr("55"), right: expr("17.5") },
          },
        ],
      },
      {
        path: "frame.tpost",
        resolve: {
          role: "frame.t_post",
          section: expr('"T50x50"'),
          material: expr("frame_material"),
        },
        name: "Sloupek T 50×50",
        when: expr("panel_count > 1"),
        bom: {
          unit: "meter",
          lengthMm: expr("(panel_count - 1) * postB"),
          quantity: expr("roundUp((panel_count - 1) * postB / 1000)"),
          category: "material",
        },
        geometry: [
          {
            key: "post",
            length: expr("postB"),
            at: [
              expr("(i + 1) * (outerFrameWidth / panel_count)"),
              expr("ground_elevation_mm + 40"),
              expr("0"),
            ],
            rotation: [expr("0"), expr("0"), expr("90")],
            repeat: { count: expr("panel_count - 1"), var: "i" },
          },
        ],
      },
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
          lengthMm: expr("panel_count * 2 * hProfileLength"),
          quantity: expr("roundUp(panel_count * 2 * hProfileLength / 1000)"),
          category: "material",
        },
        // Two verticals per panel, at each panel's inner edges.
        geometry: [
          {
            key: "upright",
            length: expr("hProfileLength"),
            at: [
              expr(
                "80 + floor(i / 2) * (outerFrameWidth / panel_count)" +
                  " + (i % 2) * (outerFrameWidth / panel_count - 160)",
              ),
              expr("ground_elevation_mm + 90"),
              expr("0"),
            ],
            rotation: [expr("0"), expr("0"), expr("90")],
            repeat: { count: expr("panel_count * 2"), var: "i" },
          },
        ],
      },
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
          lengthMm: expr("totalPieces * fillPieceLength"),
          quantity: expr("roundUp(totalPieces * fillPieceLength / 1000)"),
          category: "material",
        },
        // fillCount rows per panel, stacked at the fill option's spacing.
        geometry: [
          {
            key: "piece",
            length: expr("fillPieceLength"),
            at: [
              expr("70 + floor(i / fillCount) * (outerFrameWidth / panel_count)"),
              // ADR 0098: real spacing — slat i's centre sits `fillOffset1` above the
              // h-profile foot (ground_elevation + 90, the fill region's "end 1") then
              // steps by the real `fillPitch`. Was `+ 130 + i*min_spacing` (a fixed
              // min-pitch stack from an approximate base, ignoring the end margins).
              expr("ground_elevation_mm + 90 + fillOffset1 + (i % fillCount) * fillPitch"),
              expr("0"),
            ],
            repeat: { count: expr("totalPieces"), var: "i" },
          },
        ],
      },
      {
        path: "rail.top_guide_beam",
        resolve: { role: "rail.top_guide" },
        name: "Nosník V-horní vedení",
        // Literal 6.5 m (MVP Excel T23, not rounded).
        bom: { unit: "meter", quantity: expr("6.5"), lengthMm: expr("6500"), category: "material" },
        // ADR 0095 / CAR-18: the 6.5 m Nosník V is the LONGEST member (> railLength)
        // — the ground carrier/track the cantilever leaf rides on, extending past
        // the opening for the gate to slide fully open. It was authored at
        // `clear_height + 60` (overhead), so it floated as a full-width beam above
        // the gate attached to nothing. Seated at ground level, it spans under the
        // leaf AND the counterweight tail: the suspension diagonal D's foot lands on
        // this track over the wall, closing the tail triangle (leaf bottom carrier
        // F → track G → diagonal D). Section/exact end-positions stay a fidelity
        // item (the gates-MVP render omits this member entirely).
        geometry: [
          {
            key: "beam",
            length: expr("6500"),
            at: [expr("-150"), expr("ground_elevation_mm"), expr("0")],
          },
        ],
      },
      {
        path: "frame.tower_post",
        resolve: { role: "frame.tower_post" },
        name: "Tower sloupek",
        bom: { unit: "piece", quantity: expr("1"), category: "material" },
        geometry: [
          {
            key: "post",
            length: expr("clear_height_mm + 400"),
            at: [expr("-150"), expr("ground_elevation_mm"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
          },
        ],
      },

      // --- ACCESSORIES ---
      {
        path: "drive.gear_rack",
        resolve: { role: "drive.gear_rack" },
        name: "Hřeben V6",
        bom: { unit: "meter", quantity: expr("railMeters"), category: "accessory" },
      },
      {
        path: "frame.diagonal_tensioner",
        resolve: { role: "frame.tensioner" },
        name: "Napínák",
        bom: { unit: "piece", quantity: expr("1"), category: "accessory" },
      },
      // The ENZO rail set: the MVP's length-thresholded price ternary (U28) is
      // now two real SKUs — the threshold picks WHICH set, the price table
      // says what each costs (price truth, ENZO bypass class closed).
      {
        path: "rail.set[standard]",
        resolve: { role: "rail.set.standard" },
        name: "Sada kolejnice ENZO",
        when: expr("railLength <= 6700"),
        bom: { unit: "set", quantity: expr("1"), category: "accessory" },
      },
      {
        path: "rail.set[long]",
        resolve: { role: "rail.set.long" },
        name: "Sada kolejnice ENZO (dlouhá)",
        when: expr("railLength > 6700"),
        bom: { unit: "set", quantity: expr("1"), category: "accessory" },
      },
      {
        path: "frame.kit",
        resolve: { role: "frame.kit" },
        name: "Sada k rámu",
        bom: { unit: "set", quantity: expr("1"), category: "accessory" },
      },
      {
        path: "drive.motor",
        resolve: { role: "drive.motor" },
        name: "Pohon SOMFY ELIXO io",
        when: expr("include_motor"),
        bom: { unit: "piece", quantity: expr("1"), category: "accessory" },
      },
      {
        path: "fill.connectors",
        resolve: { role: "fill.connector" },
        name: "Spojovák výplně",
        bom: { unit: "piece", quantity: expr("totalPieces * 4"), category: "accessory" },
      },
      {
        path: "drive.gsm_module",
        resolve: { role: "drive.gsm" },
        name: "park GSM",
        bom: { unit: "piece", quantity: expr("1"), category: "accessory" },
      },
      {
        path: "drive.rack_mount",
        resolve: { role: "drive.rack_mount" },
        name: "Hřeben V6 (uchycení)",
        bom: { unit: "meter", quantity: expr("railMeters"), category: "accessory" },
      },
      {
        path: "drive.guide_roller",
        resolve: { role: "drive.guide_roller" },
        name: "Kladka JRS 30",
        bom: { unit: "piece", quantity: expr("1"), category: "accessory" },
      },

      // --- MANUFACTURING ---
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

      // --- INSTALLATION ---
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

  ports: [
    {
      id: "left",
      kind: "gate.side",
      compatibleKinds: ["fence.start", "fence.end"],
      sharing: { element: "frame.tower_post", policy: "owner" },
      anchor: { at: [expr("-150"), expr("ground_elevation_mm"), expr("0")] },
    },
    {
      id: "right",
      kind: "gate.side",
      compatibleKinds: ["fence.start", "fence.end"],
      sharing: { element: "frame.tower_post", policy: "owner" },
      anchor: { at: [expr("outerFrameWidth + 150"), expr("ground_elevation_mm"), expr("0")] },
    },
  ],

  terrain: { elevationParam: "ground_elevation_mm" },

  // Generated UI (CORE_SPEC §8 / step 6): the wizard structure ships WITH the
  // model — steps, groups, labels are vendor data, never app code.
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
        groups: [
          {
            id: "ram",
            label: "Rám",
            params: ["frame_material", "panel_count", "suspension_angle", "opening_direction"],
          },
          { id: "vypln", label: "Výplň", params: ["fill_type_id"] },
        ],
      },
      {
        id: "vybava",
        label: "Výbava a práce",
        groups: [
          { id: "pohon", label: "Pohon", params: ["include_motor"] },
          {
            id: "prace",
            label: "Práce",
            params: ["manufacturing_hours", "include_installation"],
          },
        ],
      },
    ],
  },
  // I2 delta-0 fixture (CORE_SPEC §1) — the Excel U34 anchor. The exhaustive
  // corpus lives in `golden/sliding-gate.ts`; this travels WITH the release into
  // the immutable store and is what the publish gate executes (derived-only).
  fixtures: [
    {
      name: "PLAŇKA 100 2D · 3-panel · 4.0 m (Excel U34 delta-0)",
      anchored: true,
      config: {
        opening_width_mm: 4000,
        clear_height_mm: 1500,
        suspension_angle: 35,
        panel_count: 3,
        fill_type_id: "planka_100_2d",
        opening_direction: "left",
        include_motor: true,
        include_installation: true,
        manufacturing_hours: 18,
      },
      expected: {
        derived: {
          postA: 1320,
          postB: 1220,
          diagonal: 2214,
          railLength: 5332,
          bottomRail: 4700,
          panelWidth: 1300,
          hProfileLength: 1205,
          fillCount: 11,
          fillPieceLength: 1313.3333333333333,
        },
        // Haléř re-baseline (ADR 0081): raw 81451.504 → 81451.5.
        totalPrice: 81451.5,
      },
    },
  ],
};
