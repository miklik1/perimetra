import { describe, expect, it } from "vitest";

import { expr, type Catalog, type ProductModelRelease } from "@repo/model";

import { forwardChecker, type ConstraintEvaluator } from "./constraints";
import { PriceError, priceParts, sumByCategory } from "./emit";
import { deriveInstance } from "./pipeline";
import { CatalogAmbiguityError, resolveComponent } from "./resolve";
import { buildScope, gateInput } from "./scope";
import type { Part, PriceTable } from "./types";

/** A minimal release exercising every engine seam in isolation. */
const release: ProductModelRelease = {
  id: "test@1",
  modelId: "test",
  version: 1,
  status: "published",
  parameters: [
    {
      key: "width",
      type: "length_mm",
      domain: { kind: "range", min: 1000, max: 5000 },
      adjustability: "user",
    },
    {
      key: "hours",
      type: "int",
      defaultExpr: expr("price.manufacturing_multiplier"),
      adjustability: "tenant",
    },
    { key: "fill_id", type: "select", adjustability: "user" },
    {
      key: "material",
      type: "select",
      domain: { kind: "enum", values: ["alu", "steel"] },
      default: "alu",
      adjustability: "user",
    },
    { key: "margin_floor", type: "int", default: 20, adjustability: "vendor" },
  ],
  optionSets: [
    {
      key: "fill",
      selectedBy: "fill_id",
      options: [{ id: "a", attrs: { section: "sec_a", pitch: 100 } }],
    },
  ],
  constraints: [
    // Tighter than the domain on purpose: the domain is the gate's hard
    // envelope, the constraint an engineering limit inside it.
    {
      key: "test.width.engineering_max",
      kind: "expr",
      expr: expr("width <= 4500"),
      severity: "error",
      scope: "instance",
    },
  ],
  derivation: {
    derived: [{ key: "count", expr: expr("floor(width / fill.pitch)") }],
    parts: [
      {
        path: "p.fill",
        resolve: { role: "fill", section: expr("fill.section"), material: expr("material") },
        name: "Fill",
        bom: { unit: "piece", quantity: expr("count"), category: "material" },
      },
      {
        path: "p.labor",
        resolve: { role: "labor.manufacturing" },
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

/** A minimal catalog: the fill exists in alu only — steel is a vendor gap. */
const catalog: Catalog = {
  id: "catalog@7",
  version: 7,
  materials: [
    { code: "alu", class: "metal" },
    { code: "steel", class: "metal" },
  ],
  sections: [{ code: "sec_a", shape: "flat", w_mm: 100 }],
  components: [
    {
      code: "comp_a",
      name: "Component A (alu)",
      unit: "piece",
      roles: ["fill"],
      material: "alu",
      section: "sec_a",
    },
    {
      code: "manufacturing",
      name: "Labor",
      unit: "hour",
      roles: ["labor.manufacturing"],
    },
  ],
};

const prices: PriceTable = {
  components: { comp_a: 10 },
  manufacturing: { rate: 50, multiplier: 4 },
  installation: 0,
};

const validInput = { width: 4000, fill_id: "a" };

describe("gateInput (I7 — the input gate)", () => {
  it("accepts a well-formed input", () => {
    expect(gateInput(release, validInput)).toHaveLength(0);
  });

  it.each([
    ["unknown key", { ...validInput, nope: 1 }, "engine.input.unknown_param"],
    ["dotted key", { ...validInput, "price.comp_a": 1 }, "engine.input.reserved_key"],
    ["vendor-only key", { ...validInput, margin_floor: 0 }, "engine.input.not_adjustable"],
    ["non-integer mm", { ...validInput, width: 4000.5 }, "engine.input.bad_type"],
    ["below domain min", { ...validInput, width: 500 }, "engine.input.below_min"],
    ["enum violation", { ...validInput, material: "wood" }, "engine.input.not_in_enum"],
    ["missing required param", { width: 4000 }, "engine.input.missing_param"],
  ])("rejects %s with a typed issue", (_name, input, expectedKey) => {
    const issues = gateInput(release, input);
    expect(issues.map((i) => i.key)).toContain(expectedKey);
  });

  it("carries an i18n params payload", () => {
    const issues = gateInput(release, { ...validInput, width: 500 });
    expect(issues[0]).toMatchObject({ params: { key: "width", min: 1000, value: 500 } });
  });

  it("stops the pipeline before scope assembly (no throw, invalid result)", () => {
    const result = deriveInstance(release, { ...validInput, width: 500 }, prices, catalog);
    expect(result.isValid).toBe(false);
    expect(result.issues.map((i) => i.key)).toContain("engine.input.below_min");
    expect(result.parts).toHaveLength(0);
  });
});

describe("buildScope (cascade §4)", () => {
  it("injects price.* and the selected option's attrs, and applies defaults then input", () => {
    const scope = buildScope(release, validInput, prices);
    expect(scope["price.comp_a"]).toBe(10);
    expect(scope["price.manufacturing_rate"]).toBe(50);
    expect(scope["fill.section"]).toBe("sec_a");
    expect(scope["fill.pitch"]).toBe(100);
    expect(scope.width).toBe(4000);
    expect(scope.hours).toBe(4); // default resolved from price.manufacturing_multiplier
  });

  it("input overrides a default", () => {
    const scope = buildScope(release, { ...validInput, hours: 9 }, prices);
    expect(scope.hours).toBe(9);
  });

  it("an unselectable option becomes a typed Issue, not a raw throw (taxonomy)", () => {
    const result = deriveInstance(release, { ...validInput, fill_id: "z" }, prices, catalog);
    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual([
      {
        key: "engine.option.unresolved",
        severity: "error",
        scope: "instance",
        params: { key: "fill_id", value: "z", optionSet: "fill" },
      },
    ]);
  });
});

describe("forwardChecker (constraints §3)", () => {
  it("returns no issues when constraints hold", () => {
    const scope = buildScope(release, validInput, prices);
    expect(forwardChecker.evaluate(release, scope)).toHaveLength(0);
  });

  it("raises a keyed issue when a constraint fails", () => {
    const scope = buildScope(release, { ...validInput, width: 4800 }, prices);
    const issues = forwardChecker.evaluate(release, scope);
    expect(issues).toEqual([
      { key: "test.width.engineering_max", severity: "error", scope: "instance" },
    ]);
  });

  it("is swappable behind the interface", () => {
    const noop: ConstraintEvaluator = { evaluate: () => [] };
    // width 4800 passes the domain gate; only the noop evaluator lets it through.
    const result = deriveInstance(release, { ...validInput, width: 4800 }, prices, catalog, {
      constraintEvaluator: noop,
    });
    expect(result.isValid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

describe("resolveComponent (catalog §2)", () => {
  it("resolves a fully-constrained request", () => {
    const outcome = resolveComponent(catalog, { role: "fill", section: "sec_a", material: "alu" });
    expect(outcome).toMatchObject({ ok: true, component: { code: "comp_a" } });
  });

  it("resolves an unconstrained-axes request only against agnostic components", () => {
    expect(resolveComponent(catalog, { role: "labor.manufacturing" })).toMatchObject({
      ok: true,
      component: { code: "manufacturing" },
    });
    // role exists, but every carrier is material-specific → no silent guess.
    expect(resolveComponent(catalog, { role: "fill" })).toMatchObject({ ok: false });
  });

  it("returns the missing triple as an Issue (the vendor worklist, I5)", () => {
    const outcome = resolveComponent(catalog, {
      role: "fill",
      section: "sec_a",
      material: "steel",
    });
    expect(outcome).toEqual({
      ok: false,
      issue: {
        key: "engine.catalog.unresolved",
        severity: "error",
        scope: "instance",
        params: { role: "fill", section: "sec_a", material: "steel" },
      },
    });
  });

  it("throws on ambiguous catalog data (author-time)", () => {
    const dup: Catalog = {
      ...catalog,
      components: [...catalog.components, { ...catalog.components[0]!, code: "comp_a2" }],
    };
    expect(() =>
      resolveComponent(dup, { role: "fill", section: "sec_a", material: "alu" }),
    ).toThrow(CatalogAmbiguityError);
  });
});

describe("emit (pricing §5, I5)", () => {
  const unpriced: Part = {
    path: "x",
    componentCode: "unknown",
    name: "X",
    unit: "piece",
    quantity: 1,
    category: "material",
  };

  it("throws PriceError on a missing price — never a silent zero", () => {
    expect(() => priceParts([unpriced], prices)).toThrow(PriceError);
  });

  it("refuses to aggregate an unpriced part (no ?? 0)", () => {
    expect(() => sumByCategory([unpriced])).toThrow(PriceError);
  });

  it("preserves an explicit totalPrice and computes quantity × unit otherwise", () => {
    const parts: Part[] = [
      { ...unpriced, path: "a", componentCode: "comp_a", quantity: 3 },
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
  it("resolves components through the catalog and stamps the versions (I3)", () => {
    const result = deriveInstance(release, validInput, prices, catalog);
    expect(result.isValid).toBe(true);
    expect(result.derived.count).toBe(40);
    expect(result.stamps).toEqual({ releaseId: "test@1", catalogVersion: 7 });
    const fill = result.parts.find((p) => p.path === "p.fill");
    expect(fill?.componentCode).toBe("comp_a");
    expect(fill?.totalPrice).toBe(400); // 40 × 10
    const labor = result.parts.find((p) => p.path === "p.labor");
    expect(labor?.totalPrice).toBe(200); // rate 50 × default hours 4
  });

  it("turns a catalog gap into an invalid result carrying the worklist (I5)", () => {
    const result = deriveInstance(release, { ...validInput, material: "steel" }, prices, catalog);
    expect(result.isValid).toBe(false);
    expect(result.parts).toHaveLength(0);
    expect(result.issues).toEqual([
      {
        key: "engine.catalog.unresolved",
        severity: "error",
        scope: "instance",
        params: { role: "fill", section: "sec_a", material: "steel" },
      },
    ]);
  });

  it("stops with no BOM on a constraint error (I5)", () => {
    const result = deriveInstance(release, { ...validInput, width: 4800 }, prices, catalog);
    expect(result.isValid).toBe(false);
    expect(result.issues.map((i) => i.key)).toContain("test.width.engineering_max");
    expect(result.parts).toHaveLength(0);
    expect(result.totals.total).toBe(0);
  });
});
