import { describe, expect, it } from "vitest";

import { expr, type Catalog, type ProductModelRelease } from "@repo/model";

import { checkFixture, checkFixtures } from "./fixtures.js";

/** Minimal release: one derived dimension off an option-set attribute. */
const release: ProductModelRelease = {
  id: "fx@1",
  modelId: "fx",
  version: 1,
  status: "published",
  parameters: [
    { key: "width", type: "length_mm", adjustability: "user" },
    { key: "fill_id", type: "select", adjustability: "user" },
    { key: "material", type: "select", default: "alu", adjustability: "user" },
  ],
  optionSets: [
    {
      key: "fill",
      selectedBy: "fill_id",
      options: [{ id: "a", attrs: { section: "sec_a", pitch: 100 } }],
    },
  ],
  constraints: [],
  derivation: {
    derived: [{ key: "count", expr: expr("floor(width / fill.pitch)") }],
    parts: [
      {
        path: "p.fill",
        resolve: { role: "fill", section: expr("fill.section"), material: expr("material") },
        name: "Fill",
        bom: { unit: "piece", quantity: expr("count"), category: "material" },
      },
    ],
  },
  fixtures: [],
};

const catalog: Catalog = {
  id: "cat@1",
  version: 1,
  materials: [{ code: "alu", class: "metal" }],
  sections: [{ code: "sec_a", shape: "flat", w_mm: 100 }],
  components: [
    {
      code: "comp_a",
      name: "A",
      unit: "piece",
      roles: ["fill"],
      material: "alu",
      section: "sec_a",
    },
  ],
};

const config = { width: 4000, fill_id: "a" };

describe("checkFixture / checkFixtures (CORE_SPEC §1 I2)", () => {
  it("passes when the expected derived dimensions reproduce", () => {
    const r = checkFixture(
      release,
      { name: "ok", anchored: true, config, expected: { derived: { count: 40 } } },
      catalog,
    );
    expect(r.ok).toBe(true);
    expect(r.mismatches).toEqual([]);
    expect(r.issues).toEqual([]);
  });

  it("fails with a mismatch when a derived value is wrong (price-free)", () => {
    const r = checkFixture(
      release,
      { name: "bad", anchored: true, config, expected: { derived: { count: 99 } } },
      catalog,
    );
    expect(r.ok).toBe(false);
    expect(r.mismatches).toEqual([{ key: "count", expected: 99, actual: 40 }]);
  });

  it("fails with an issue when the config can't build a scope", () => {
    const r = checkFixture(
      release,
      { name: "err", anchored: false, config: { width: 4000, fill_id: "ghost" }, expected: {} },
      catalog,
    );
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it("maps over release.fixtures (empty → [])", () => {
    expect(checkFixtures({ ...release, fixtures: [] }, catalog)).toEqual([]);
    const checks = checkFixtures(
      {
        ...release,
        fixtures: [{ name: "ok", anchored: true, config, expected: { derived: { count: 40 } } }],
      },
      catalog,
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]!.ok).toBe(true);
  });
});
