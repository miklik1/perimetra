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

  optionSets: [
    {
      key: "fill",
      selectedBy: "fill_type_id",
      options: [
        {
          id: "planka_100_2d",
          label: "PLAŇKA 100 2D",
          attrs: {
            profile_mm: 100,
            dimension_type: "2D",
            min_spacing_mm: 101,
            section_code: "planka_100",
          },
        },
        {
          id: "lamela_113_3d",
          label: "Lamela 113 3D",
          attrs: {
            profile_mm: 113,
            dimension_type: "3D",
            min_spacing_mm: 90,
            section_code: "lamela_113",
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
          {
            key: "postA",
            length: expr("postA"),
            at: [expr("0"), expr("ground_elevation_mm + 40"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
          },
          {
            key: "postB",
            length: expr("postB"),
            at: [expr("outerFrameWidth"), expr("ground_elevation_mm + 40"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
          },
          // The cantilever suspension diagonal: rises from the rear post top
          // toward the front at the suspension angle — its mitre cut is the
          // cut list's angled-cut proof.
          {
            key: "diagonal",
            length: expr("diagonal"),
            at: [expr("outerFrameWidth"), expr("ground_elevation_mm + 40 + postB"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("180 - suspension_angle")],
            cuts: { left: expr("suspension_angle"), right: expr("90") },
          },
          {
            key: "bottom",
            length: expr("bottomRail"),
            at: [expr("0"), expr("ground_elevation_mm + 40"), expr("0")],
          },
          {
            key: "rail",
            length: expr("railLength"),
            at: [expr("0"), expr("ground_elevation_mm"), expr("60")],
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
              expr("ground_elevation_mm + 130 + (i % fillCount) * fill.min_spacing_mm"),
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
        geometry: [
          {
            key: "beam",
            length: expr("6500"),
            at: [expr("-150"), expr("ground_elevation_mm + clear_height_mm + 60"), expr("0")],
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
        totalPrice: 81451.504,
      },
    },
  ],
};
