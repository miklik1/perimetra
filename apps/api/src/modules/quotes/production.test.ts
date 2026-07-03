import { describe, expect, it } from "vitest";

import {
  isProducible,
  productionSafeDrawing,
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
});
