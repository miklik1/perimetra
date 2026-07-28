/**
 * validateRelease — step-4 publish-gate additions: ports, terrain binding,
 * and connection-scope constraint references (the `self.*`/`other.*` pairing
 * deriveSite evaluates against). The positive paths are locked by the
 * authored releases in @repo/fixtures; these are the defect codes.
 */
import { describe, expect, it } from "vitest";

import { expr } from "./expr.js";
import type { ProductModelRelease } from "./schema.js";
import { validateRelease } from "./validate.js";

const base: ProductModelRelease = {
  id: "t@1",
  modelId: "t",
  version: 1,
  status: "draft",
  parameters: [
    { key: "len", type: "length_mm", adjustability: "user" },
    { key: "vendor_len", type: "length_mm", default: 1, adjustability: "vendor" },
    { key: "label", type: "text", default: "x", adjustability: "user" },
  ],
  constraints: [],
  derivation: {
    derived: [{ key: "top", expr: expr("len + 1") }],
    parts: [
      {
        path: "cap",
        resolve: { role: "cap" },
        name: "Cap",
        bom: { unit: "piece", quantity: expr("1"), category: "material" },
      },
    ],
  },
  // Non-empty so the I2 `fixtures.empty` structural check passes — validateRelease
  // only checks PRESENCE (execution is the engine's checkFixtures, tested there).
  fixtures: [{ name: "t", anchored: false, config: { len: 1 }, expected: { derived: { top: 2 } } }],
};

const codes = (release: ProductModelRelease) => validateRelease(release).map((d) => d.code);

describe("validateRelease — fixtures (CORE_SPEC §1 I2)", () => {
  it("flags a release that ships no golden fixtures", () => {
    expect(codes({ ...base, fixtures: [] })).toContain("fixtures.empty");
    expect(codes({ ...base, fixtures: undefined })).toContain("fixtures.empty");
  });

  it("accepts a release that ships at least one fixture", () => {
    expect(codes(base)).not.toContain("fixtures.empty");
  });
});

describe("validateRelease — ports (CORE_SPEC §5)", () => {
  it("accepts a port whose sharing element is a real part path", () => {
    expect(
      codes({
        ...base,
        ports: [
          {
            id: "p",
            kind: "k",
            compatibleKinds: ["k"],
            sharing: { element: "cap", policy: "owner" },
          },
        ],
      }),
    ).toEqual([]);
  });

  it("rejects a sharing element that names no part", () => {
    expect(
      codes({
        ...base,
        ports: [
          {
            id: "p",
            kind: "k",
            compatibleKinds: ["k"],
            sharing: { element: "ghost", policy: "owner" },
          },
        ],
      }),
    ).toEqual(["port.element.unknown"]);
  });

  it("rejects duplicate port ids", () => {
    expect(
      codes({
        ...base,
        ports: [
          { id: "p", kind: "k", compatibleKinds: ["k"] },
          { id: "p", kind: "k2", compatibleKinds: ["k2"] },
        ],
      }),
    ).toEqual(["key.duplicate"]);
  });
});

describe("validateRelease — terrain binding (one write path, I7)", () => {
  it("rejects an unknown elevation parameter", () => {
    expect(codes({ ...base, terrain: { elevationParam: "ghost" } })).toEqual([
      "terrain.param.unknown",
    ]);
  });

  it("rejects a non-length elevation parameter", () => {
    expect(codes({ ...base, terrain: { elevationParam: "label" } })).toEqual([
      "terrain.param.type",
    ]);
  });

  it("rejects a vendor-only elevation parameter (the gate would reject every placement)", () => {
    expect(codes({ ...base, terrain: { elevationParam: "vendor_len" } })).toEqual([
      "terrain.param.unwritable",
    ]);
  });
});

describe("validateRelease — connection-scope constraint references", () => {
  const withConstraint = (source: string): ProductModelRelease => ({
    ...base,
    constraints: [
      { key: "c", kind: "expr", expr: expr(source), severity: "error", scope: "connection" },
    ],
  });

  it("accepts self.* refs to params/derived and any other.* ref", () => {
    expect(codes(withConstraint("abs(self.top - other.whatever) <= self.len"))).toEqual([]);
  });

  it("rejects a self.* ref that is not in this release's scope", () => {
    expect(codes(withConstraint("self.ghost > 0"))).toEqual(["ref.unknown"]);
  });

  it("rejects bare (unprefixed) refs — connection scopes are paired", () => {
    expect(codes(withConstraint("len > 0"))).toEqual(["ref.unknown"]);
  });

  it("rejects price.* refs — connection constraints are never commercial", () => {
    expect(codes(withConstraint("price.cap > 0"))).toEqual(["ref.unknown"]);
  });
});

describe("validateRelease — geometry (step 5)", () => {
  const withGeometry = (
    geometry: NonNullable<ProductModelRelease["derivation"]["parts"][number]["geometry"]>,
  ): ProductModelRelease => ({
    ...base,
    derivation: {
      ...base.derivation,
      parts: [{ ...base.derivation.parts[0]!, geometry }],
    },
  });

  it("accepts keyed pieces with repeat vars and cut/rotation exprs", () => {
    expect(
      codes(
        withGeometry([
          {
            key: "piece",
            length: expr("len"),
            at: [expr("i * 100"), expr("top"), expr("0")],
            rotation: [expr("0"), expr("0"), expr("90")],
            cuts: { left: expr("45") },
            repeat: { count: expr("3"), var: "i" },
          },
        ]),
      ),
    ).toEqual([]);
  });

  it("rejects duplicate and non-identifier geometry keys (I9 addressing)", () => {
    const rule: NonNullable<
      ProductModelRelease["derivation"]["parts"][number]["geometry"]
    >[number] = {
      key: "a",
      length: expr("1"),
      at: [expr("0"), expr("0"), expr("0")],
    };
    expect(codes(withGeometry([rule, { ...rule }]))).toContain("key.duplicate");
    expect(codes(withGeometry([{ ...rule, key: "a.b[0]" }]))).toContain("key.invalid");
  });

  it("rejects a repeat var that shadows a scope name, and refs outside scope", () => {
    expect(
      codes(
        withGeometry([
          {
            key: "a",
            length: expr("1"),
            at: [expr("0"), expr("0"), expr("0")],
            repeat: { count: expr("2"), var: "len" },
          },
        ]),
      ),
    ).toContain("repeat.var.invalid");
    // The repeat var is NOT in scope for the count itself.
    expect(
      codes(
        withGeometry([
          {
            key: "a",
            length: expr("1"),
            at: [expr("0"), expr("0"), expr("0")],
            repeat: { count: expr("i + 1"), var: "i" },
          },
        ]),
      ),
    ).toContain("ref.unknown");
  });

  it("checks port anchor exprs against the full part scope", () => {
    expect(
      codes({
        ...base,
        ports: [
          {
            id: "p",
            kind: "k",
            compatibleKinds: ["k"],
            anchor: { at: [expr("top"), expr("0"), expr("0")] },
          },
        ],
      }),
    ).toEqual([]);
    expect(
      codes({
        ...base,
        ports: [
          {
            id: "p",
            kind: "k",
            compatibleKinds: ["k"],
            anchor: { at: [expr("nope"), expr("0"), expr("0")] },
          },
        ],
      }),
    ).toContain("ref.unknown");
  });
});

describe("validateRelease — generated ui (CORE_SPEC §8)", () => {
  const ui = (params: string[], extra?: Partial<ProductModelRelease>): ProductModelRelease => ({
    ...base,
    ...extra,
    ui: { steps: [{ id: "s", groups: [{ id: "g", params }] }] },
  });

  it("accepts a spec covering every writable parameter once", () => {
    expect(codes(ui(["len", "label"]))).toEqual([]);
  });

  it("rejects unknown and duplicated parameter refs", () => {
    expect(codes(ui(["len", "label", "nope"]))).toContain("ui.param.unknown");
    expect(codes(ui(["len", "len", "label"]))).toContain("ui.param.duplicate");
  });

  it("rejects vendor-only parameters on the surface (I7)", () => {
    expect(codes(ui(["len", "label", "vendor_len"]))).toContain("ui.param.vendor");
  });

  it("rejects an uncovered writable parameter (silently uneditable)", () => {
    expect(codes(ui(["len"]))).toContain("ui.param.uncovered");
  });

  it("rejects duplicate step and group ids", () => {
    expect(
      codes({
        ...base,
        ui: {
          steps: [
            { id: "s", groups: [{ id: "g", params: ["len"] }] },
            { id: "s", groups: [{ id: "g", params: ["label"] }] },
          ],
        },
      }),
    ).toContain("key.duplicate");
  });

  it("leaves releases without ui untouched (defaultUi is the consumer's job)", () => {
    expect(codes(base)).toEqual([]);
  });
});

describe("validateRelease — dimension roles (ADR 0136)", () => {
  /** A release whose parameters carry the given roles. The base derivation reads
   *  `len`, so every case keeps that parameter; nothing else in the gate cares. */
  const roles = (parameters: ProductModelRelease["parameters"]): ProductModelRelease => ({
    ...base,
    parameters,
  });

  const bounded = (key: string, extra?: Partial<ProductModelRelease["parameters"][number]>) =>
    ({
      key,
      type: "length_mm",
      adjustability: "user",
      domain: { kind: "range", min: 100, max: 900 },
      ...extra,
    }) satisfies ProductModelRelease["parameters"][number];

  const len = base.parameters[0]!;

  it("accepts one width and one height on bounded, user-writable parameters", () => {
    expect(
      codes(
        roles([
          len,
          bounded("w", { dimensionRole: "width" }),
          bounded("h", { dimensionRole: "height" }),
        ]),
      ),
    ).toEqual([]);
  });

  it("leaves a release that authors no role alone (the positional fallback still applies)", () => {
    expect(codes(roles([len, bounded("w"), bounded("h")]))).toEqual([]);
  });

  it("rejects a role claimed by two parameters", () => {
    const defects = validateRelease(
      roles([
        len,
        bounded("w", { dimensionRole: "width" }),
        bounded("w2", { dimensionRole: "width" }),
      ]),
    );
    expect(defects.map((d) => d.code)).toContain("dimensionRole.duplicate");
    // The defect lands on the SECOND claimant — the one the editor must fix.
    expect(defects.find((d) => d.code === "dimensionRole.duplicate")?.where).toBe(
      "parameters[w2].dimensionRole",
    );
  });

  it("rejects a role on a parameter a drag could not clamp", () => {
    // No domain at all.
    expect(
      codes(
        roles([
          len,
          { key: "w", type: "length_mm", adjustability: "user", dimensionRole: "width" },
        ]),
      ),
    ).toContain("dimensionRole.domain");
    // A range domain missing one bound is just as unclampable as none.
    expect(
      codes(
        roles([
          len,
          {
            key: "w",
            type: "length_mm",
            adjustability: "user",
            domain: { kind: "range", min: 100 },
            dimensionRole: "width",
          },
        ]),
      ),
    ).toContain("dimensionRole.domain");
    // A non-range domain cannot carry bounds at all.
    expect(
      codes(
        roles([
          len,
          {
            key: "w",
            type: "select",
            adjustability: "user",
            domain: { kind: "enum", values: ["a", "b"] },
            dimensionRole: "width",
          },
        ]),
      ),
    ).toContain("dimensionRole.domain");
  });

  it("rejects a role on a vendor-only parameter (I7 — the pill would 403 itself)", () => {
    expect(
      codes(roles([len, bounded("w", { adjustability: "vendor", dimensionRole: "width" })])),
    ).toContain("dimensionRole.vendor");
  });
});
