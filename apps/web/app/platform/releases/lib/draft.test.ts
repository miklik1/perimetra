/**
 * The structured parts/geometry → `ProductModelRelease` mapping (ADR 0068
 * Phase 2). Guards the I-side rules: an empty Expr string OMITS its optional slot
 * (so a blank field never freezes an empty expression into the release), the
 * rotation/cuts/repeat toggles gate their blocks, and `role`/`repeat.var` cross
 * as plain strings while every other slot is wrapped by `expr()`.
 */
import { describe, expect, it } from "vitest";

import { expr } from "@repo/model";

import { blankDraft, blankGeometry, blankPart, buildReleaseFromDraft } from "./draft";
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
