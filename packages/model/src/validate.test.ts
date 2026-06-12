/**
 * validateRelease — step-4 publish-gate additions: ports, terrain binding,
 * and connection-scope constraint references (the `self.*`/`other.*` pairing
 * deriveSite evaluates against). The positive paths are locked by the
 * authored releases in @repo/fixtures; these are the defect codes.
 */
import { describe, expect, it } from "vitest";

import { expr } from "./expr";
import type { ProductModelRelease } from "./schema";
import { validateRelease } from "./validate";

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
};

const codes = (release: ProductModelRelease) => validateRelease(release).map((d) => d.code);

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
