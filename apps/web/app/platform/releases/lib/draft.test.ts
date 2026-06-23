/**
 * The structured parts/geometry → `ProductModelRelease` mapping (ADR 0068
 * Phase 2). Guards the I-side rules: an empty Expr string OMITS its optional slot
 * (so a blank field never freezes an empty expression into the release), the
 * rotation/cuts/repeat toggles gate their blocks, and `role`/`repeat.var` cross
 * as plain strings while every other slot is wrapped by `expr()`.
 */
import { describe, expect, it } from "vitest";

import { expr, type ProductModelRelease } from "@repo/model";

import {
  blankDraft,
  blankGeometry,
  blankPart,
  buildReleaseFromDraft,
  draftFromRelease,
} from "./draft";
import { releaseDraftSchema } from "./section-schemas";

function buildParts(parts: ReturnType<typeof blankPart>[]) {
  const draft = releaseDraftSchema.parse({ ...blankDraft(), modelId: "m", parts });
  return buildReleaseFromDraft(draft).release.derivation.parts;
}

describe("buildReleaseFromDraft — parts", () => {
  it("maps a full part rule, wrapping Expr slots and keeping role plain", () => {
    const [part] = buildParts([
      {
        ...blankPart(),
        path: "post",
        name: "Post",
        role: "post.vertical",
        section: '"jakl_30x30"',
        material: "",
        when: "",
        bomUnit: "piece",
        bomQuantity: "1",
        bomLengthMm: "height_mm",
        bomCategory: "material",
      },
    ]);
    expect(part!.path).toBe("post");
    expect(part!.name).toBe("Post");
    expect(part!.resolve.role).toBe("post.vertical");
    expect(part!.resolve.section).toEqual(expr('"jakl_30x30"'));
    expect(part!.bom.unit).toBe("piece");
    expect(part!.bom.quantity).toEqual(expr("1"));
    expect(part!.bom.lengthMm).toEqual(expr("height_mm"));
  });

  it("omits optional slots left blank (no empty expressions frozen in)", () => {
    const [part] = buildParts([
      { ...blankPart(), path: "x", name: "X", role: "r", bomQuantity: "1" },
    ]);
    expect(part!.resolve.section).toBeUndefined();
    expect(part!.resolve.material).toBeUndefined();
    expect(part!.when).toBeUndefined();
    expect(part!.bom.lengthMm).toBeUndefined();
    expect(part!.bom.pricePerUnit).toBeUndefined();
    expect(part!.bom.totalPrice).toBeUndefined();
    expect(part!.geometry).toBeUndefined();
  });

  it("gates geometry rotation/cuts/repeat on their toggles; repeat.var is plain", () => {
    const [part] = buildParts([
      {
        ...blankPart(),
        path: "bar",
        name: "Bar",
        role: "r",
        bomQuantity: "1",
        geometry: [
          {
            ...blankGeometry(),
            key: "b",
            length: "height_mm",
            useRotation: true,
            rotZ: "90",
            cutLeft: "45",
            cutRight: "",
            useRepeat: true,
            repeatCount: "count",
            repeatVar: "i",
          },
        ],
      },
    ]);
    const geo = part!.geometry![0]!;
    expect(geo.key).toBe("b");
    expect(geo.at).toEqual([expr("0"), expr("0"), expr("0")]);
    expect(geo.rotation).toEqual([expr("0"), expr("0"), expr("90")]);
    expect(geo.cuts).toEqual({ left: expr("45") }); // right blank → omitted
    expect(geo.repeat).toEqual({ count: expr("count"), var: "i" });
  });

  it("drops the rotation/cuts/repeat blocks when their toggles are off", () => {
    const [part] = buildParts([
      {
        ...blankPart(),
        path: "p",
        name: "P",
        role: "r",
        bomQuantity: "1",
        geometry: [{ ...blankGeometry(), key: "g", length: "1" }],
      },
    ]);
    const geo = part!.geometry![0]!;
    expect(geo.rotation).toBeUndefined();
    expect(geo.cuts).toBeUndefined();
    expect(geo.repeat).toBeUndefined();
  });
});

// A release exercising every branch of the inverse: literal/expr/no default,
// each domain kind, a hard deviation with bounds, a part with all BOM extras +
// two geometry pieces (one full rotation/cuts/repeat, one minimal), and the JSON
// islands (terrain + fixtures, the latter carrying a mixed-type config + both
// expected fields). `buildReleaseFromDraft(parse(draftFromRelease(r)))` must reproduce it.
const SAMPLE: ProductModelRelease = {
  id: "sliding-gate@1",
  modelId: "sliding-gate",
  version: 1,
  status: "draft",
  parameters: [
    {
      key: "width_mm",
      type: "length_mm",
      adjustability: "user",
      label: "Width",
      default: 4000,
      domain: { kind: "range", min: 1000, max: 6000, step: 10 },
    },
    {
      key: "material",
      type: "select",
      adjustability: "user",
      defaultExpr: expr('"alu"'),
      relevance: expr("width_mm > 2000"),
      domain: { kind: "enum", values: ["alu", "steel"] },
    },
    {
      key: "locked",
      type: "bool",
      adjustability: "vendor",
      deviation: { mode: "hard", bounds: { min: expr("0"), max: expr("10") }, note: "limit" },
    },
  ],
  constraints: [
    {
      key: "min_width",
      kind: "expr",
      expr: expr("width_mm >= 1000"),
      severity: "error",
      scope: "instance",
    },
  ],
  derivation: {
    derived: [{ key: "leaf_w", expr: expr("width_mm / 2") }],
    parts: [
      {
        path: "frame",
        name: "Frame",
        resolve: {
          role: "post.vertical",
          section: expr('"jakl_30x30"'),
          material: expr('"alu"'),
        },
        when: expr("width_mm > 0"),
        bom: {
          unit: "meter",
          quantity: expr("2"),
          category: "material",
          lengthMm: expr("width_mm"),
          pricePerUnit: expr("12"),
          totalPrice: expr("24"),
        },
        geometry: [
          {
            key: "bar",
            length: expr("width_mm"),
            at: [expr("0"), expr("0"), expr("0")],
            rotation: [expr("0"), expr("90"), expr("0")],
            cuts: { left: expr("45"), right: expr("45") },
            repeat: { count: expr("2"), var: "i" },
          },
          { key: "post", length: expr("2000"), at: [expr("0"), expr("0"), expr("0")] },
        ],
      },
    ],
  },
  terrain: { elevationParam: "width_mm" },
  fixtures: [
    {
      name: "delta0",
      anchored: true,
      config: { width_mm: 4000, material: "alu" },
      expected: { derived: { leaf_w: 2000 }, totalPrice: 24 },
    },
  ],
};

describe("draftFromRelease — clone-and-bump inverse", () => {
  it("round-trips a release through the editor draft shape (same version)", () => {
    const draft = releaseDraftSchema.parse(draftFromRelease(SAMPLE, SAMPLE.version, 2));
    const { release, islandDefects } = buildReleaseFromDraft(draft);
    expect(islandDefects).toEqual([]);
    expect(release).toEqual(SAMPLE);
  });

  it("bumps the version (and the derived id) while keeping the model", () => {
    const draft = releaseDraftSchema.parse(draftFromRelease(SAMPLE, SAMPLE.version + 1, 2));
    expect(draft.modelId).toBe("sliding-gate");
    expect(draft.version).toBe(2);
    const { release } = buildReleaseFromDraft(draft);
    expect(release.id).toBe("sliding-gate@2");
  });
});
