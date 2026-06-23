/**
 * slotScopes — the single source of scope truth that validateRelease consumes
 * and the release editor's autocomplete reads. These lock:
 *   - the per-slot `known`/`openPrefixes` for every kind of expression slot
 *     (default sees earlier params only; relevance/derived/part scopes widen;
 *     connection constraints carry self.* + the open other.* prefix; a geometry
 *     repeat var is injected into the piece scope but NOT the count scope), and
 *   - that validateRelease actually CONSUMES these scopes (an out-of-scope ref
 *     is rejected exactly where slotScopes says it would be) — the anti-drift
 *     guarantee: the two can never disagree.
 */
import { describe, expect, it } from "vitest";

import { expr } from "./expr.js";
import type { ProductModelRelease } from "./schema.js";
import { slotScopes, validateRelease } from "./validate.js";

/** A release exercising every expression slot kind. */
const release: ProductModelRelease = {
  id: "t@1",
  modelId: "t",
  version: 1,
  status: "draft",
  parameters: [
    { key: "w", type: "length_mm", adjustability: "user" },
    { key: "h", type: "length_mm", adjustability: "user", defaultExpr: expr("w") },
    { key: "mat", type: "select", adjustability: "user", default: "alu" },
    { key: "show", type: "bool", adjustability: "user", default: true, relevance: expr("w > 0") },
    {
      key: "lim",
      type: "length_mm",
      adjustability: "user",
      deviation: { mode: "hard", bounds: { min: expr("0"), max: expr("w") } },
    },
  ],
  optionSets: [
    {
      key: "fill",
      selectedBy: "mat",
      options: [
        { id: "a", attrs: { spacing: 50 } },
        { id: "b", attrs: { spacing: 60, depth: 10 } },
      ],
    },
  ],
  constraints: [
    { key: "ci", kind: "expr", expr: expr("w <= 5000"), severity: "error", scope: "instance" },
    {
      key: "cc",
      kind: "expr",
      expr: expr("self.w == other.w"),
      severity: "error",
      scope: "connection",
    },
  ],
  derivation: {
    derived: [
      { key: "d1", expr: expr("w + h") },
      { key: "d2", expr: expr("d1 * 2") },
    ],
    parts: [
      {
        path: "p1",
        resolve: { role: "r", material: expr("mat") },
        name: "P1",
        when: expr("show"),
        bom: {
          unit: "meter",
          quantity: expr("d1"),
          lengthMm: expr("w"),
          category: "material",
        },
        geometry: [
          { key: "g1", length: expr("w"), at: [expr("0"), expr("0"), expr("0")] },
          {
            key: "g2",
            length: expr("i"),
            at: [expr("i * 10"), expr("0"), expr("0")],
            repeat: { count: expr("d2"), var: "i" },
          },
        ],
      },
    ],
  },
  ports: [
    {
      id: "port",
      kind: "k",
      compatibleKinds: ["k"],
      anchor: { at: [expr("d1"), expr("0"), expr("0")] },
    },
  ],
  // Non-empty so the I2 `fixtures.empty` structural check passes (this suite
  // asserts validateRelease is otherwise clean).
  fixtures: [{ name: "f", anchored: false, config: {}, expected: { derived: {} } }],
};

const PARAMS_AND_ATTRS = ["fill.depth", "fill.spacing", "h", "lim", "mat", "show", "w"];
const sorted = (s: ReadonlySet<string>): string[] => [...s].sort();
const knownOf = (where: string): string[] => {
  const scope = slotScopes(release).get(where);
  if (!scope) throw new Error(`no slot scope for "${where}"`);
  return sorted(scope.known);
};

describe("slotScopes — per-slot scope", () => {
  it("defaultExpr sees EARLIER params only (buildScope order)", () => {
    expect(knownOf("parameters[h].defaultExpr")).toEqual(["w"]);
  });

  it("relevance + deviation bounds see all params + option attrs", () => {
    expect(knownOf("parameters[show].relevance")).toEqual(PARAMS_AND_ATTRS);
    expect(knownOf("parameters[lim].deviation.min")).toEqual(PARAMS_AND_ATTRS);
    expect(knownOf("parameters[lim].deviation.max")).toEqual(PARAMS_AND_ATTRS);
  });

  it("instance constraints see params + option attrs and the price.* prefix", () => {
    expect(knownOf("constraints[ci]")).toEqual(PARAMS_AND_ATTRS);
    expect(slotScopes(release).get("constraints[ci]")?.openPrefixes).toEqual(["price."]);
  });

  it("connection constraints carry self.* names + the open other.* prefix", () => {
    expect(knownOf("constraints[cc]")).toEqual([
      "self.d1",
      "self.d2",
      "self.fill.depth",
      "self.fill.spacing",
      "self.h",
      "self.lim",
      "self.mat",
      "self.show",
      "self.w",
    ]);
    expect(slotScopes(release).get("constraints[cc]")?.openPrefixes).toEqual(["other."]);
  });

  it("derived widens incrementally — each sees only EARLIER derived", () => {
    expect(knownOf("derived[d1]")).toEqual(PARAMS_AND_ATTRS);
    expect(knownOf("derived[d2]")).toEqual([...PARAMS_AND_ATTRS, "d1"].sort());
  });

  it("parts see the full scope (params + option attrs + ALL derived)", () => {
    const full = [...PARAMS_AND_ATTRS, "d1", "d2"].sort();
    expect(knownOf("parts[p1].when")).toEqual(full);
    expect(knownOf("parts[p1].resolve.material")).toEqual(full);
    expect(knownOf("parts[p1].bom.quantity")).toEqual(full);
    expect(knownOf("parts[p1].bom.lengthMm")).toEqual(full);
    expect(knownOf("ports[port].anchor.at[0]")).toEqual(full);
  });

  it("a geometry repeat var is injected into the piece scope but NOT the count", () => {
    const full = [...PARAMS_AND_ATTRS, "d1", "d2"].sort();
    expect(knownOf("parts[p1].geometry[g2].repeat.count")).toEqual(full); // no "i"
    expect(knownOf("parts[p1].geometry[g2].length")).toEqual([...full, "i"].sort());
    expect(knownOf("parts[p1].geometry[g2].at[0]")).toEqual([...full, "i"].sort());
    // A non-repeating piece never sees a var.
    expect(knownOf("parts[p1].geometry[g1].length")).toEqual(full);
  });
});

describe("slotScopes — validateRelease consumes it (no drift)", () => {
  it("the well-formed release validates clean", () => {
    expect(validateRelease(release)).toEqual([]);
  });

  it("a ref out-of-scope per slotScopes is rejected at exactly that where", () => {
    // d1 referencing d2 is a forward reference — slotScopes says d2 is not in
    // d1's scope, and validateRelease must agree.
    const forward: ProductModelRelease = {
      ...release,
      derivation: {
        ...release.derivation,
        derived: [
          { key: "d1", expr: expr("d2") },
          { key: "d2", expr: expr("w + h") },
        ],
      },
    };
    expect(slotScopes(forward).get("derived[d1]")?.known.has("d2")).toBe(false);
    const refDefects = validateRelease(forward).filter((d) => d.code === "ref.unknown");
    expect(refDefects).toEqual([
      {
        code: "ref.unknown",
        where: "derived[d1]",
        message: 'reference "d2" will not be in scope here',
      },
    ]);
  });

  it("every ref.unknown defect's `where` is a slotScopes key (anti-drift invariant)", () => {
    // A release with out-of-scope refs across several slot kinds.
    const broken: ProductModelRelease = {
      ...release,
      parameters: [
        { key: "w", type: "length_mm", adjustability: "user" },
        { key: "h", type: "length_mm", adjustability: "user", defaultExpr: expr("ghostA") },
      ],
      optionSets: [],
      constraints: [
        { key: "ci", kind: "expr", expr: expr("ghostB > 0"), severity: "error", scope: "instance" },
      ],
      derivation: {
        derived: [{ key: "d1", expr: expr("ghostC") }],
        parts: [
          {
            path: "p1",
            resolve: { role: "r" },
            name: "P1",
            bom: { unit: "piece", quantity: expr("ghostD"), category: "material" },
          },
        ],
      },
      ports: [],
    };
    const keys = new Set(slotScopes(broken).keys());
    const refDefects = validateRelease(broken).filter((d) => d.code === "ref.unknown");
    expect(refDefects.length).toBeGreaterThanOrEqual(4);
    for (const d of refDefects) expect(keys.has(d.where)).toBe(true);
  });
});
