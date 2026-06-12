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
      type: "length_mm",
      domain: { kind: "range", min: 2000, max: 8000 },
      adjustability: "user",
    },
    {
      key: "clear_height_mm",
      type: "length_mm",
      domain: { kind: "range", min: 800, max: 2500 },
      adjustability: "user",
    },
    {
      key: "suspension_angle",
      type: "int",
      domain: { kind: "enum", values: ["35", "40", "45"] },
      adjustability: "user",
    },
    {
      key: "panel_count",
      type: "int",
      domain: { kind: "enum", values: ["2", "3"] },
      adjustability: "user",
    },
    { key: "fill_type_id", type: "select", adjustability: "user" },
    {
      key: "frame_material",
      type: "select",
      domain: { kind: "enum", values: ["alu", "steel"] },
      default: "alu",
      adjustability: "user",
    },
    {
      key: "opening_direction",
      type: "select",
      domain: { kind: "enum", values: ["left", "right"] },
      adjustability: "user",
    },
    { key: "include_motor", type: "bool", default: true, adjustability: "user" },
    { key: "include_installation", type: "bool", default: true, adjustability: "user" },
    {
      key: "manufacturing_hours",
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
      },
      {
        path: "rail.top_guide_beam",
        resolve: { role: "rail.top_guide" },
        name: "Nosník V-horní vedení",
        // Literal 6.5 m (MVP Excel T23, not rounded).
        bom: { unit: "meter", quantity: expr("6.5"), lengthMm: expr("6500"), category: "material" },
      },
      {
        path: "frame.tower_post",
        resolve: { role: "frame.tower_post" },
        name: "Tower sloupek",
        bom: { unit: "piece", quantity: expr("1"), category: "material" },
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
};
