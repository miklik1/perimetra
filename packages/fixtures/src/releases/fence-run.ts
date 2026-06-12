/**
 * `fence-run@1` — the second authored product family (CORE_SPEC §10 step 4):
 * a straight fence run of `fieldCount` fields between `fieldCount + 1` posts.
 * Authored to prove the SITE mechanics, so the end posts are individual parts
 * (I9 stable paths), because sharing consumes a specific element:
 *
 *   posts.start ──field── posts.line[…] ──field── posts.end
 *
 * Ports (I6): `end` OWNS its post; `start` CONSUMES — a standalone run has
 * both posts, a run connected at its start attaches to the neighbor's element
 * (the previous run's end post, or a gate's tower post) and drops its own.
 *
 * Terrain (CORE_SPEC §5): `ground_elevation_mm` is the declared elevation
 * parameter — a placement's stepped-terrain segment drives it through the
 * input gate. The connection rule `fence.connection.top_step` is the model's
 * stepped-vs-invalid judgment: neighboring top lines may step at most 200 mm.
 *
 * Geometry is hand-authored for the harness (no Excel anchor — `anchored:
 * false` corpus); the real fabricator chain is a FIL-extraction item.
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
      type: "length_mm",
      domain: { kind: "range", min: 1000, max: 30000 },
      adjustability: "user",
    },
    {
      key: "clear_height_mm",
      type: "length_mm",
      domain: { kind: "range", min: 800, max: 2000 },
      adjustability: "user",
    },
    {
      key: "ground_elevation_mm",
      type: "length_mm",
      domain: { kind: "range", min: -5000, max: 5000 },
      default: 0,
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
      key: "manufacturing_hours",
      type: "int",
      defaultExpr: expr("price.manufacturing_multiplier"),
      adjustability: "tenant",
    },
    { key: "include_installation", type: "bool", default: true, adjustability: "user" },
  ],

  optionSets: [
    {
      key: "fill",
      selectedBy: "fill_type_id",
      options: [
        {
          id: "planka_100_2d",
          label: "PLAŇKA 100 2D",
          attrs: { profile_mm: 100, min_spacing_mm: 101, section_code: "planka_100" },
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
    // The stepped-terrain judgment (CORE_SPEC §5): neighboring top lines may
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
      { key: "fieldCount", expr: expr("roundUp(run_length_mm / 2500)") },
      { key: "innerPostCount", expr: expr("fieldCount - 1") },
      { key: "fieldWidth", expr: expr("run_length_mm / fieldCount") },
      { key: "postLength", expr: expr("clear_height_mm + 500") },
      { key: "topLine", expr: expr("ground_elevation_mm + clear_height_mm") },
      { key: "fillRows", expr: expr("floor((clear_height_mm - 100) / fill.min_spacing_mm)") },
      { key: "fillPieces", expr: expr("fillRows * fieldCount") },
    ],

    parts: [
      // --- MATERIAL ---
      {
        path: "posts.start",
        resolve: {
          role: "fence.post",
          section: expr('"jakl_60x60"'),
          material: expr("frame_material"),
        },
        name: "Sloupek krajní (začátek)",
        bom: {
          unit: "piece",
          quantity: expr("1"),
          lengthMm: expr("postLength"),
          category: "material",
        },
      },
      {
        path: "posts.end",
        resolve: {
          role: "fence.post",
          section: expr('"jakl_60x60"'),
          material: expr("frame_material"),
        },
        name: "Sloupek krajní (konec)",
        bom: {
          unit: "piece",
          quantity: expr("1"),
          lengthMm: expr("postLength"),
          category: "material",
        },
      },
      {
        path: "posts.line",
        resolve: {
          role: "fence.post",
          section: expr('"jakl_60x60"'),
          material: expr("frame_material"),
        },
        name: "Sloupek průběžný",
        when: expr("fieldCount > 1"),
        bom: {
          unit: "piece",
          quantity: expr("innerPostCount"),
          lengthMm: expr("postLength"),
          category: "material",
        },
      },
      {
        path: "rails.run",
        resolve: {
          role: "fence.rail",
          section: expr('"jakl_40x20"'),
          material: expr("frame_material"),
        },
        name: "Příčle (horní + spodní)",
        bom: {
          unit: "meter",
          lengthMm: expr("2 * run_length_mm"),
          quantity: expr("roundUp(2 * run_length_mm / 1000)"),
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
          lengthMm: expr("fillPieces * fieldWidth"),
          quantity: expr("roundUp(fillPieces * fieldWidth / 1000)"),
          category: "material",
        },
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
      id: "start",
      kind: "fence.start",
      compatibleKinds: ["fence.end", "gate.side"],
      sharing: { element: "posts.start", policy: "consumer" },
    },
    {
      id: "end",
      kind: "fence.end",
      compatibleKinds: ["fence.start", "gate.side"],
      sharing: { element: "posts.end", policy: "owner" },
    },
  ],

  terrain: { elevationParam: "ground_elevation_mm" },
};
