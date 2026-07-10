import { describe, expect, it } from "vitest";

import {
  isProducible,
  productionSafeDrawing,
  productionSafeTechnicalDrawing,
  toProduction,
  type ProductionSourceSnapshot,
} from "./production.js";

describe("isProducible — only issued/accepted have a build (CAR-24)", () => {
  it("permits issued and accepted", () => {
    expect(isProducible("issued")).toBe(true);
    expect(isProducible("accepted")).toBe(true);
  });

  it("refuses draft/declined/expired — nothing to build", () => {
    expect(isProducible("draft")).toBe(false);
    expect(isProducible("declined")).toBe(false);
    expect(isProducible("expired")).toBe(false);
  });
});

describe("productionSafeDrawing — drops commercial deviation flags", () => {
  it("keeps physical flags (quantity/lengthMm)", () => {
    const drawing = {
      quads: [],
      dims: [],
      flags: [
        { partPath: "post", field: "lengthMm", value: 2100, overrideId: "o1" },
        { partPath: "post", field: "quantity", value: 3, overrideId: "o2" },
      ],
      bbox: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
    } as Parameters<typeof productionSafeDrawing>[0];

    expect(productionSafeDrawing(drawing).flags).toEqual(drawing.flags);
  });

  it("strips a commercial pricePerUnit/totalPrice flag — the narrow I10 leak vector", () => {
    const drawing = {
      quads: [],
      dims: [],
      flags: [
        { partPath: "post", field: "quantity", value: 3, overrideId: "o1" },
        // A price override on a part would otherwise carry a raw float here.
        { partPath: "post", field: "pricePerUnit", value: 999.5, overrideId: "o2" },
        { partPath: "post", field: "totalPrice", value: 1998, overrideId: "o3" },
      ],
      bbox: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
    } as Parameters<typeof productionSafeDrawing>[0];

    const safe = productionSafeDrawing(drawing);
    expect(safe.flags).toEqual([
      { partPath: "post", field: "quantity", value: 3, overrideId: "o1" },
    ]);
    expect(JSON.stringify(safe)).not.toContain("999.5");
    expect(JSON.stringify(safe)).not.toContain("1998");
  });
});

describe("toProduction — the workshop-safe shape (CAR-24)", () => {
  const row = {
    id: "q1",
    documentNumber: "2026/0001",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
  };

  const snapshot: ProductionSourceSnapshot = {
    bom: [
      {
        componentCode: "POST",
        name: "Sloupek",
        unit: "piece",
        category: "material",
        quantity: 2,
        totalPrice: 4000,
        totalPriceMoney: "4000",
        sources: [{ instanceId: "gate", path: "posts[0]" }],
      },
    ],
    cutList: { components: [] },
    cutOptions: { kerfMm: 3 },
    drawings: {
      site: { instances: [], connections: [], terrain: [] },
      instances: {
        gate: {
          quads: [],
          dims: [],
          flags: [{ partPath: "post", field: "pricePerUnit", value: 999, overrideId: "o1" }],
          bbox: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
        },
      },
    },
    inputs: { gate: { releaseId: "sliding-gate@1" } },
  };

  it("carries quantities, drops totalPrice/totalPriceMoney, and labels instances by release", () => {
    const production = toProduction(row, "issued", snapshot);

    expect(production.id).toBe("q1");
    expect(production.documentNumber).toBe("2026/0001");
    expect(production.status).toBe("issued");
    expect(production.instances).toEqual([{ instanceId: "gate", releaseId: "sliding-gate@1" }]);
    expect(production.bom).toEqual([
      {
        componentCode: "POST",
        name: "Sloupek",
        unit: "piece",
        category: "material",
        quantity: 2,
        sources: [{ instanceId: "gate", path: "posts[0]" }],
      },
    ]);
    // NEVER money — a whitelist, not a blacklist (mirrors blindSnapshot, ADR 0056).
    expect(JSON.stringify(production)).not.toContain("4000");
    expect(JSON.stringify(production)).not.toContain("totalPrice");
  });

  it("also strips the commercial flag from a per-instance drawing", () => {
    const production = toProduction(row, "issued", snapshot);
    expect(production.drawings.instances.gate?.flags).toEqual([]);
    expect(JSON.stringify(production)).not.toContain("999");
  });

  it("a pre-slice snapshot (no technical drawing / spec rows) omits the new fields, never throws", () => {
    const production = toProduction(row, "issued", snapshot);
    expect(production.technicalDrawings).toBeUndefined();
    expect(production.specRows).toBeUndefined();
    expect(production.dimensionRows).toBeUndefined();
  });
});

describe("toProduction — frozen technical drawing + spec/dimension rows (ADR 0108)", () => {
  const row = {
    id: "q2",
    documentNumber: "2026/0002",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  };

  const base: ProductionSourceSnapshot = {
    bom: [
      {
        componentCode: "POST",
        name: "Sloupek",
        unit: "piece",
        category: "material",
        quantity: 2,
        totalPrice: 4000,
        totalPriceMoney: "4000",
        sources: [{ instanceId: "gate", path: "posts[0]" }],
      },
    ],
    cutList: { components: [] },
    cutOptions: { kerfMm: 3 },
    drawings: {
      site: { instances: [], connections: [], terrain: [] },
      instances: {},
    },
    inputs: { gate: { releaseId: "sliding-gate@1" } },
  };

  /** A frozen drawing exercising every dimension-row rule: a labeled dimension,
   *  a label-less chain (falls back to the rule id), a label callout (never a
   *  row), and a dimension with no measured value (skipped). Carries a section
   *  so the allowlist copy is proven to pass it through. */
  const withDrawings: ProductionSourceSnapshot = {
    ...base,
    technicalDrawings: {
      gate: {
        viewId: "front",
        edges: [
          {
            id: "e1",
            sourceId: "gate/posts.start/post#0",
            role: "visible",
            from: { x: 0, y: 0 },
            to: { x: 0, y: 100 },
          },
        ],
        annotations: [
          {
            id: "overall.width",
            kind: "dimension",
            label: "Celková šířka",
            valueMm: 4000,
            line: { from: { x: 0, y: 0 }, to: { x: 4000, y: 0 } },
            witness: [],
            textAt: { x: 2000, y: -30 },
          },
          {
            id: "fill.pitch",
            kind: "chain",
            valueMm: 116,
            line: { from: { x: 0, y: 0 }, to: { x: 0, y: 1492 } },
            witness: [],
            ticks: [{ x: 0, y: 100 }],
            textAt: { x: -30, y: 700 },
          },
          {
            id: "member.A",
            kind: "label",
            text: "A",
            line: { from: { x: 50, y: 50 }, to: { x: 50, y: 50 } },
            witness: [],
            textAt: { x: 50, y: 50 },
          },
          {
            id: "no.value",
            kind: "dimension",
            line: { from: { x: 0, y: 0 }, to: { x: 10, y: 0 } },
            witness: [],
            textAt: { x: 5, y: -30 },
          },
        ],
        bbox: { min: { x: 0, y: 0 }, max: { x: 4000, y: 1492 } },
        sections: [
          {
            sectionId: "A-A",
            axis: "x",
            offsetMm: 1000,
            cuts: [
              {
                sourceId: "gate/fill.material/piece[0]",
                componentCode: "PLANKA",
                outline: [
                  { x: 0, y: 0 },
                  { x: 100, y: 0 },
                ],
                nominalDepth: true,
              },
            ],
            bbox: { min: { x: 0, y: 0 }, max: { x: 100, y: 20 } },
            dataFillNeeded: true,
          },
        ],
      },
    },
    specRows: {
      gate: [
        { key: "opening_width_mm", label: "Šířka otvoru", value: "4000 mm" },
        { key: "fill_type_id", label: "Výplň", value: "Planka 100" },
      ],
    },
  };

  it("allowlist-copies the technical drawing verbatim (geometry, no money)", () => {
    const production = toProduction(row, "issued", withDrawings);
    expect(production.technicalDrawings?.gate).toEqual(withDrawings.technicalDrawings!.gate);
  });

  it("projects the frozen spec-sheet rows unchanged", () => {
    const production = toProduction(row, "issued", withDrawings);
    expect(production.specRows?.gate).toEqual(withDrawings.specRows!.gate);
  });

  it("derives dimension rows: dimension + chain only, label falls back to id, no-value skipped", () => {
    const production = toProduction(row, "issued", withDrawings);
    expect(production.dimensionRows?.gate).toEqual([
      { id: "overall.width", label: "Celková šířka", valueMm: 4000 },
      { id: "fill.pitch", label: "fill.pitch", valueMm: 116 },
    ]);
  });

  it("never leaks money through the new fields", () => {
    const production = toProduction(row, "issued", withDrawings);
    // The mm dimension 4000 is legitimate geometry; the BOM's money price must
    // not survive as a key. `"4000"` (fully quoted) is the money string — the
    // spec-row "4000 mm" and the numeric geometry 4000 never produce that token.
    expect(JSON.stringify(production)).not.toContain('"totalPrice');
    expect(JSON.stringify(production)).not.toContain('"4000"');
    expect(production.bom[0]).not.toHaveProperty("totalPriceMoney");
  });

  it("productionSafeTechnicalDrawing keeps the whole geometry field set", () => {
    const safe = productionSafeTechnicalDrawing(withDrawings.technicalDrawings!.gate!);
    expect(safe).toEqual(withDrawings.technicalDrawings!.gate);
  });
});
