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
 * Single-material (aluminum) and option-carried fill attrs are the slice-1
 * shape; role-based multi-material resolution is step 2.
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
      default: expr("price.manufacturing_multiplier"),
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
            material_component_code: "planka_100",
          },
        },
        {
          id: "lamela_113_3d",
          label: "Lamela 113 3D",
          attrs: {
            profile_mm: 113,
            dimension_type: "3D",
            min_spacing_mm: 90,
            material_component_code: "lamela_113",
          },
        },
      ],
    },
  ],

  constraints: [
    {
      key: "sliding.opening_width.range",
      kind: "range",
      expr: expr("opening_width_mm >= 2000 && opening_width_mm <= 8000"),
      severity: "error",
      scope: "instance",
    },
    {
      key: "sliding.clear_height.range",
      kind: "range",
      expr: expr("clear_height_mm >= 800 && clear_height_mm <= 2500"),
      severity: "error",
      scope: "instance",
    },
    {
      key: "sliding.suspension_angle.allowed",
      kind: "expr",
      expr: expr("suspension_angle == 35 || suspension_angle == 40 || suspension_angle == 45"),
      severity: "error",
      scope: "instance",
    },
    {
      key: "sliding.panel_count.allowed",
      kind: "expr",
      expr: expr("panel_count == 2 || panel_count == 3"),
      severity: "error",
      scope: "instance",
    },
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
        componentCode: "sloupek_l_50",
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
        componentCode: "sloupek_t_50",
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
        componentCode: "h_profile_50",
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
        componentCode: "fill",
        componentCodeExpr: expr("fill.material_component_code"),
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
        componentCode: "top_guide_beam",
        name: "Nosník V-horní vedení",
        // Literal 6.5 m (MVP Excel T23, not rounded).
        bom: { unit: "meter", quantity: expr("6.5"), lengthMm: expr("6500"), category: "material" },
      },
      {
        path: "frame.tower_post",
        componentCode: "tower_post",
        name: "Tower sloupek",
        bom: { unit: "piece", quantity: expr("1"), category: "material" },
      },

      // --- ACCESSORIES ---
      {
        path: "drive.gear_rack",
        componentCode: "gear_rack",
        name: "Hřeben V6",
        bom: { unit: "meter", quantity: expr("railMeters"), category: "accessory" },
      },
      {
        path: "frame.diagonal_tensioner",
        componentCode: "diagonal_tensioner",
        name: "Napínák",
        bom: { unit: "piece", quantity: expr("1"), category: "accessory" },
      },
      {
        path: "rail.set_enzo",
        componentCode: "rail_set_enzo",
        name: "Sada kolejnice ENZO",
        // Length-thresholded fixed price (MVP U28).
        bom: {
          unit: "set",
          quantity: expr("1"),
          totalPrice: expr("if(railLength > 6700, 24500, 11650) + 1000"),
          category: "accessory",
        },
      },
      {
        path: "frame.kit",
        componentCode: "frame_kit",
        name: "Sada k rámu",
        bom: { unit: "set", quantity: expr("1"), category: "accessory" },
      },
      {
        path: "drive.motor",
        componentCode: "motor",
        name: "Pohon SOMFY ELIXO io",
        when: expr("include_motor"),
        bom: { unit: "piece", quantity: expr("1"), category: "accessory" },
      },
      {
        path: "fill.connectors",
        componentCode: "fill_connector",
        name: "Spojovák výplně",
        bom: { unit: "piece", quantity: expr("totalPieces * 4"), category: "accessory" },
      },
      {
        path: "drive.gsm_module",
        componentCode: "gsm_module",
        name: "park GSM",
        bom: { unit: "piece", quantity: expr("1"), category: "accessory" },
      },
      {
        path: "drive.rack_mount",
        componentCode: "rack_mount",
        name: "Hřeben V6 (uchycení)",
        bom: { unit: "meter", quantity: expr("railMeters"), category: "accessory" },
      },
      {
        path: "drive.guide_roller",
        componentCode: "guide_roller",
        name: "Kladka JRS 30",
        bom: { unit: "piece", quantity: expr("1"), category: "accessory" },
      },

      // --- MANUFACTURING ---
      {
        path: "labor.manufacturing",
        componentCode: "manufacturing",
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
        componentCode: "installation",
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
