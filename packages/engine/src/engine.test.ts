import { describe, expect, it } from "vitest";

import { expr, type ProductModelRelease } from "@repo/model";

import { forwardChecker } from "./constraints";
import { PriceError, priceParts, sumByCategory } from "./emit";
import { deriveInstance } from "./pipeline";
import { buildScope } from "./scope";
import type { ConstraintEvaluator, Part, PriceTable } from "./types";

/** A minimal release exercising every engine seam in isolation. */
const release: ProductModelRelease = {
  id: "test@1",
  modelId: "test",
  version: 1,
  status: "published",
  parameters: [
    { key: "width", type: "length_mm", adjustability: "user" },
    {
      key: "hours",
      type: "int",
      default: expr("price.manufacturing_multiplier"),
      adjustability: "tenant",
    },
    { key: "fill_id", type: "select", adjustability: "user" },
  ],
  optionSets: [
    {
      key: "fill",
      selectedBy: "fill_id",
      options: [{ id: "a", attrs: { code: "comp_a", pitch: 100 } }],
    },
  ],
  constraints: [
    {
      key: "test.width.range",
      kind: "range",
      expr: expr("width >= 1000 && width <= 5000"),
      severity: "error",
      scope: "instance",
    },
  ],
  derivation: {
    derived: [{ key: "count", expr: expr("floor(width / fill.pitch)") }],
    parts: [
      {
        path: "p.fill",
        componentCode: "fallback",
        componentCodeExpr: expr("fill.code"),
        name: "Fill",
        bom: { unit: "piece", quantity: expr("count"), category: "material" },
      },
      {
        path: "p.labor",
        componentCode: "manufacturing",
        name: "Labor",
        bom: {
          unit: "hour",
          quantity: expr("hours"),
          totalPrice: expr("price.manufacturing_rate * hours"),
          category: "manufacturing",
        },
      },
    ],
  },
};

const prices: PriceTable = {
  components: { comp_a: 10 },
  manufacturing: { rate: 50, multiplier: 4 },
  installation: 0,
};

describe("buildScope (cascade §4)", () => {
  it("injects price.* and the selected option's attrs, and applies defaults then input", () => {
    const scope = buildScope(release, { width: 4000, fill_id: "a" }, prices);
    expect(scope["price.comp_a"]).toBe(10);
    expect(scope["price.manufacturing_rate"]).toBe(50);
    expect(scope["fill.code"]).toBe("comp_a");
    expect(scope["fill.pitch"]).toBe(100);
    expect(scope.width).toBe(4000);
    expect(scope.hours).toBe(4); // default resolved from price.manufacturing_multiplier
  });

  it("input overrides a default", () => {
    const scope = buildScope(release, { width: 4000, fill_id: "a", hours: 9 }, prices);
    expect(scope.hours).toBe(9);
  });

  it("throws on an unselectable option (no silent fallthrough)", () => {
    expect(() => buildScope(release, { width: 4000, fill_id: "z" }, prices)).toThrow(
      /Unresolved option/,
    );
  });
});

describe("forwardChecker (constraints §3)", () => {
  it("returns no issues when constraints hold", () => {
    const scope = buildScope(release, { width: 4000, fill_id: "a" }, prices);
    expect(forwardChecker.evaluate(release, scope)).toHaveLength(0);
  });

  it("raises a keyed issue when a constraint fails", () => {
    const scope = buildScope(release, { width: 50, fill_id: "a" }, prices);
    const issues = forwardChecker.evaluate(release, scope);
    expect(issues).toEqual([{ key: "test.width.range", severity: "error", scope: "instance" }]);
  });

  it("is swappable behind the interface", () => {
    const noop: ConstraintEvaluator = { evaluate: () => [] };
    const result = deriveInstance(release, { width: 50, fill_id: "a" }, prices, {
      constraintEvaluator: noop,
    });
    expect(result.isValid).toBe(true); // the failing range is ignored by the noop evaluator
  });
});

describe("emit (pricing §5, I5)", () => {
  it("throws PriceError on a missing price — never a silent zero", () => {
    const parts: Part[] = [
      {
        path: "x",
        componentCode: "unknown",
        name: "X",
        unit: "piece",
        quantity: 1,
        category: "material",
      },
    ];
    expect(() => priceParts(parts, prices)).toThrow(PriceError);
  });

  it("preserves an explicit totalPrice and computes quantity × unit otherwise", () => {
    const parts: Part[] = [
      {
        path: "a",
        componentCode: "comp_a",
        name: "A",
        unit: "piece",
        quantity: 3,
        category: "material",
      },
      {
        path: "b",
        componentCode: "fixed",
        name: "B",
        unit: "set",
        quantity: 1,
        totalPrice: 999,
        category: "accessory",
      },
    ];
    const priced = priceParts(parts, prices);
    expect(priced[0]!.totalPrice).toBe(30);
    expect(priced[1]!.totalPrice).toBe(999);
    expect(sumByCategory(priced)).toMatchObject({ material: 30, accessory: 999, total: 1029 });
  });
});

describe("deriveInstance (pipeline §5)", () => {
  it("resolves option-driven component codes and rate-based labor", () => {
    const result = deriveInstance(release, { width: 4000, fill_id: "a" }, prices);
    expect(result.isValid).toBe(true);
    expect(result.derived.count).toBe(40);
    const fill = result.parts.find((p) => p.path === "p.fill");
    expect(fill?.componentCode).toBe("comp_a");
    expect(fill?.totalPrice).toBe(400); // 40 × 10
    const labor = result.parts.find((p) => p.path === "p.labor");
    expect(labor?.totalPrice).toBe(200); // rate 50 × default hours 4
  });

  it("stops with no BOM on a constraint error (I5)", () => {
    const result = deriveInstance(release, { width: 50, fill_id: "a" }, prices);
    expect(result.isValid).toBe(false);
    expect(result.parts).toHaveLength(0);
    expect(result.totals.total).toBe(0);
  });
});
