import { describe, expect, it } from "vitest";

import { expr, type Catalog, type Override, type ProductModelRelease } from "@repo/model";

import type { CascadeLayers } from "./cascade.js";
import { forwardChecker, type ConstraintEvaluator } from "./constraints.js";
import { PriceError, priceParts, sumByCategory } from "./emit.js";
import { recurrenceReport } from "./ledger.js";
import { deriveInstance } from "./pipeline.js";
import { CatalogAmbiguityError, resolveComponent } from "./resolve.js";
import { buildScope, gateInput } from "./scope.js";
import type { Part, PriceTable } from "./types.js";

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
      // Deviation envelope is WIDER than the domain below the min: a quote may
      // bend down to 800 with a reason (warn), never below.
      deviation: {
        mode: "warn",
        bounds: { min: expr("800"), max: expr("5000") },
        note: "frame stiffness untested below 800",
      },
    },
    {
      key: "depth",
      type: "int",
      domain: { kind: "range", min: 100, max: 200 },
      default: 150,
      adjustability: "user",
      // Hard knowledge: bounds reject outside, no ceremony inside.
      deviation: { mode: "hard", bounds: { min: expr("50"), max: expr("300") } },
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
  version: 3,
  components: { comp_a: 10 },
  manufacturing: { rate: 50, multiplier: 4 },
  installation: 0,
};

/** Override factory — quote scope unless stated. */
const ov = (patch: Partial<Override> & Pick<Override, "target" | "value">): Override => ({
  id: `ov-${patch.target}`,
  scope: "quote",
  scopeRef: "quote-1",
  author: "sales@test",
  createdAt: "2026-06-12T00:00:00.000Z",
  ...patch,
});

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
    const noop: ConstraintEvaluator = { evaluate: () => [], evaluateConnection: () => [] };
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
    expect(result.stamps).toEqual({
      releaseId: "test@1",
      catalogVersion: 7,
      priceTableVersion: 3,
      overrideIds: [],
    });
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

  it("mirrors totals as decimal strings at the money boundary (I10)", () => {
    const result = deriveInstance(release, validInput, prices, catalog);
    expect(result.money).toEqual({
      material: "400",
      accessory: "0",
      manufacturing: "200",
      installation: "0",
      total: "600",
    });
  });
});

describe("resolveCascade (§4 — overrides through the one write path)", () => {
  const derive = (overrides: CascadeLayers) =>
    deriveInstance(release, validInput, prices, catalog, { overrides });

  it("a tenant price override repoints the table and is stamped (I3)", () => {
    const o = ov({ scope: "tenant", scopeRef: "t1", target: "price:comp_a", value: 12 });
    const result = derive({ tenant: [o] });
    expect(result.isValid).toBe(true);
    expect(result.parts.find((p) => p.path === "p.fill")?.totalPrice).toBe(480);
    expect(result.stamps.overrideIds).toEqual([o.id]);
  });

  it("removing an override restores the layer below — never mutates it (I8)", () => {
    const o = ov({ scope: "tenant", scopeRef: "t1", target: "price:comp_a", value: 12 });
    derive({ tenant: [o] });
    const without = derive({});
    expect(without.parts.find((p) => p.path === "p.fill")?.totalPrice).toBe(400);
    expect(without.stamps.overrideIds).toEqual([]);
  });

  it("a customer default patch applies under user input (input still wins)", () => {
    const o = ov({ scope: "customer", scopeRef: "c1", target: "param:hours", value: 8 });
    const patched = derive({ customer: [o] });
    expect(patched.parts.find((p) => p.path === "p.labor")?.totalPrice).toBe(400); // 50 × 8
    const result = deriveInstance(release, { ...validInput, hours: 2 }, prices, catalog, {
      overrides: { customer: [o] },
    });
    expect(result.parts.find((p) => p.path === "p.labor")?.totalPrice).toBe(100); // input wins
  });

  it("a tenant/customer param patch must stay inside the domain (not a deviation)", () => {
    const o = ov({ scope: "tenant", scopeRef: "t1", target: "param:width", value: 900 });
    const result = derive({ tenant: [o] });
    expect(result.isValid).toBe(false);
    expect(result.issues.map((i) => i.key)).toContain("engine.input.below_min");
  });

  it("a quote deviation passes outside the domain, inside bounds, with a reason (warn + flag)", () => {
    const o = ov({ target: "param:width", value: 900, reason: "client plot is 900" });
    const result = derive({ quote: [o] });
    expect(result.isValid).toBe(true);
    expect(result.derived.count).toBe(9);
    expect(result.issues).toContainEqual({
      key: "engine.deviation.applied",
      severity: "warn",
      scope: "instance",
      params: {
        key: "width",
        value: 900,
        reason: "client plot is 900",
        note: "frame stiffness untested below 800",
      },
    });
    expect(result.stamps.overrideIds).toEqual([o.id]);
  });

  it("warn-mode deviation without a reason is rejected", () => {
    const result = derive({ quote: [ov({ target: "param:width", value: 900 })] });
    expect(result.isValid).toBe(false);
    expect(result.issues.map((i) => i.key)).toContain("engine.deviation.reason_required");
  });

  it("deviation bounds reject outside — the product does not bend there", () => {
    const result = derive({
      quote: [ov({ target: "param:width", value: 700, reason: "still no" })],
    });
    expect(result.isValid).toBe(false);
    expect(result.issues.map((i) => i.key)).toContain("engine.deviation.out_of_bounds");
  });

  it("hard-mode deviation needs no ceremony inside bounds, rejects outside", () => {
    const inside = derive({ quote: [ov({ target: "param:depth", value: 250 })] });
    expect(inside.isValid).toBe(true);
    expect(inside.issues).toHaveLength(0);
    const outside = derive({ quote: [ov({ target: "param:depth", value: 400 })] });
    expect(outside.isValid).toBe(false);
    expect(outside.issues.map((i) => i.key)).toContain("engine.deviation.out_of_bounds");
  });

  it("a parameter without a deviation spec does not bend beyond its domain", () => {
    const result = derive({
      quote: [ov({ target: "param:material", value: "wood", reason: "x" })],
    });
    expect(result.isValid).toBe(false);
    expect(result.issues.map((i) => i.key)).toContain("engine.input.not_in_enum");
  });

  it("no scope may write a vendor parameter (I7)", () => {
    for (const layer of [
      { tenant: [ov({ scope: "tenant", scopeRef: "t1", target: "param:margin_floor", value: 0 })] },
      { quote: [ov({ target: "param:margin_floor", value: 0, reason: "x" })] },
    ]) {
      const result = derive(layer);
      expect(result.isValid).toBe(false);
      expect(result.issues.map((i) => i.key)).toContain("engine.input.not_adjustable");
    }
  });

  it("rejects malformed targets, scope mismatches, and non-quote artifact overrides", () => {
    const result = derive({
      tenant: [
        ov({ scope: "tenant", scopeRef: "t1", target: "nonsense", value: 1 }),
        ov({ scope: "quote", scopeRef: "q9", target: "price:comp_a", value: 1 }),
        ov({ scope: "tenant", scopeRef: "t1", target: "artifact:p.fill.quantity", value: 1 }),
      ],
    });
    expect(result.isValid).toBe(false);
    expect(result.issues.map((i) => i.key)).toEqual(
      expect.arrayContaining([
        "engine.override.bad_target",
        "engine.override.scope_mismatch",
        "engine.override.artifact_scope",
      ]),
    );
  });

  it("flags a price override that creates a NEW code (typo guard, warn only)", () => {
    const result = derive({
      tenant: [ov({ scope: "tenant", scopeRef: "t1", target: "price:comp_typo", value: 5 })],
    });
    expect(result.isValid).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ key: "engine.override.new_price_code", severity: "warn" }),
    );
  });
});

describe("artifact overrides (§6 — flagged, never silent)", () => {
  const quantity = (resolution: "keep_price" | "reprice") =>
    ov({
      target: "artifact:p.fill.quantity",
      value: 42,
      reason: "one extra row",
      pricingResolution: resolution,
    });

  it("patches quantity with an explicit reprice and flags the part + result", () => {
    const result = deriveInstance(release, validInput, prices, catalog, {
      overrides: { quote: [quantity("reprice")] },
    });
    expect(result.isValid).toBe(true);
    const fill = result.parts.find((p) => p.path === "p.fill")!;
    expect(fill.quantity).toBe(42);
    expect(fill.totalPrice).toBe(420);
    expect(fill.deviations).toEqual([
      {
        field: "quantity",
        original: 40,
        value: 42,
        overrideId: quantity("reprice").id,
        reason: "one extra row",
      },
    ]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ key: "engine.deviation.artifact", severity: "warn" }),
    );
    expect(result.totals.material).toBe(420);
  });

  it("keep_price pins the derived line total", () => {
    const result = deriveInstance(release, validInput, prices, catalog, {
      overrides: { quote: [quantity("keep_price")] },
    });
    const fill = result.parts.find((p) => p.path === "p.fill")!;
    expect(fill.quantity).toBe(42);
    expect(fill.totalPrice).toBe(400);
  });

  it("a quantity patch without a pricing resolution is rejected", () => {
    const result = deriveInstance(release, validInput, prices, catalog, {
      overrides: { quote: [ov({ target: "artifact:p.fill.quantity", value: 42 })] },
    });
    expect(result.isValid).toBe(false);
    expect(result.issues.map((i) => i.key)).toContain(
      "engine.override.pricing_resolution_required",
    );
  });

  it("repricing a fixed-total line is an error, not a guess (I5)", () => {
    const result = deriveInstance(release, validInput, prices, catalog, {
      overrides: {
        quote: [
          ov({
            target: "artifact:p.labor.quantity",
            value: 9,
            pricingResolution: "reprice",
          }),
        ],
      },
    });
    expect(result.isValid).toBe(false);
    expect(result.issues.map((i) => i.key)).toContain("engine.override.cannot_reprice");
  });

  it("a stale artifact address is an error — the deviation must exist (I5/I9)", () => {
    const result = deriveInstance(release, validInput, prices, catalog, {
      overrides: {
        quote: [
          ov({ target: "artifact:p.gone.totalPrice", value: 1, pricingResolution: "reprice" }),
        ],
      },
    });
    expect(result.isValid).toBe(false);
    expect(result.issues.map((i) => i.key)).toContain("engine.override.artifact_missing");
  });

  it("a totalPrice patch is itself the pricing resolution", () => {
    const result = deriveInstance(release, validInput, prices, catalog, {
      overrides: { quote: [ov({ target: "artifact:p.labor.totalPrice", value: 999 })] },
    });
    expect(result.isValid).toBe(true);
    expect(result.parts.find((p) => p.path === "p.labor")?.totalPrice).toBe(999);
    expect(result.totals.manufacturing).toBe(999);
  });
});

describe("exception ledger (§4 — deviations become data)", () => {
  const entries: Override[] = [
    ov({ id: "a", scopeRef: "q1", target: "param:width", value: 900, reason: "plot" }),
    ov({ id: "b", scopeRef: "q2", target: "param:width", value: 910, reason: "plot again" }),
    ov({ id: "c", scopeRef: "q2", target: "param:width", value: 905 }),
    ov({ id: "d", scopeRef: "q3", target: "artifact:p.fill.quantity", value: 42 }),
    ov({ id: "e", scope: "tenant", scopeRef: "t1", target: "price:comp_a", value: 12 }),
  ];

  it("groups quote-scope overrides by target into the promotion queue", () => {
    expect(recurrenceReport(entries)).toEqual([
      {
        target: "param:width",
        occurrences: 3,
        distinctQuotes: 2,
        values: [900, 910, 905],
        reasons: ["plot", "plot again"],
      },
    ]);
  });

  it("tenant-layer overrides are config, not exceptions — excluded", () => {
    expect(recurrenceReport(entries, 1).map((g) => g.target)).toEqual([
      "param:width",
      "artifact:p.fill.quantity",
    ]);
  });
});

describe("geometry derivation (§3 / step 5)", () => {
  /** The test release with piece geometry + an anchored port grafted on. */
  const withGeometry: ProductModelRelease = {
    ...release,
    derivation: {
      ...release.derivation,
      parts: [
        {
          ...release.derivation.parts[0]!,
          geometry: [
            {
              key: "piece",
              length: expr("fill.pitch"),
              at: [expr("i * fill.pitch"), expr("0"), expr("0")],
              rotation: [expr("0"), expr("0"), expr("45")],
              cuts: { left: expr("45") },
              repeat: { count: expr("count"), var: "i" },
            },
          ],
        },
        release.derivation.parts[1]!,
      ],
    },
    ports: [
      {
        id: "side",
        kind: "test.side",
        compatibleKinds: ["test.side"],
        anchor: { at: [expr("width"), expr("0"), expr("0")] },
      },
    ],
  };
  const input = { width: 1000, fill_id: "a", hours: 4 };

  it("expands repeat into addressed pieces, degrees → arc-minutes (I9/I10)", () => {
    const result = deriveInstance(withGeometry, input, prices, catalog);
    expect(result.isValid).toBe(true);
    const fill = result.parts.find((p) => p.path === "p.fill")!;
    expect(fill.geometry!.pieces.map((p) => p.id)).toEqual([
      "piece[0]",
      "piece[1]",
      "piece[2]",
      "piece[3]",
      "piece[4]",
      "piece[5]",
      "piece[6]",
      "piece[7]",
      "piece[8]",
      "piece[9]",
    ]);
    expect(fill.geometry!.pieces[3]!.at).toEqual([300, 0, 0]);
    expect(fill.geometry!.pieces[0]!.rotationArcMin).toEqual([0, 0, 2700]);
    expect(fill.geometry!.pieces[0]!.cutArcMin).toEqual({ left: 2700 });
    // Profile baked from the resolved component's catalog section (I4).
    expect(fill.geometry!.profile).toEqual({ shape: "flat", wMm: 100 });
    // BOM-only parts stay geometry-free.
    expect(result.parts.find((p) => p.path === "p.labor")!.geometry).toBeUndefined();
  });

  it("evaluates port anchors against the full post-derivation scope", () => {
    const result = deriveInstance(withGeometry, input, prices, catalog);
    expect(result.anchors).toEqual({ side: [1000, 0, 0] });
    // A release without anchors keeps the field absent — not an empty object.
    expect(deriveInstance(release, input, prices, catalog).anchors).toBeUndefined();
  });

  it("a fractional repeat count is an authoring defect — throws, never truncates (I5)", () => {
    const broken: ProductModelRelease = {
      ...withGeometry,
      derivation: {
        ...withGeometry.derivation,
        parts: [
          {
            ...withGeometry.derivation.parts[0]!,
            geometry: [
              {
                key: "piece",
                length: expr("10"),
                at: [expr("0"), expr("0"), expr("0")],
                repeat: { count: expr("width / 300"), var: "i" },
              },
            ],
          },
        ],
      },
    };
    expect(() => deriveInstance(broken, input, prices, catalog)).toThrow(/non-negative integer/);
  });

  it("a component naming a ghost section is a catalog defect — throws (ADR 0047)", () => {
    // The component row points at a section code its own catalog release
    // doesn't carry — internal catalog disagreement, author-shaped.
    const brokenCatalog: Catalog = {
      ...catalog,
      components: [{ ...catalog.components[0]!, section: "ghost" }, catalog.components[1]!],
    };
    const rule = {
      ...withGeometry.derivation.parts[0]!,
      resolve: { role: "fill", section: expr('"ghost"'), material: expr("material") },
    };
    const broken: ProductModelRelease = {
      ...withGeometry,
      derivation: { ...withGeometry.derivation, parts: [rule] },
    };
    expect(() => deriveInstance(broken, input, prices, brokenCatalog)).toThrow(
      /unknown section "ghost"/,
    );
  });
});
