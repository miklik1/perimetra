import { describe, expect, it } from "vitest";

import type { ParameterDef, ResolvedUiStep } from "@repo/model";

import {
  clampToBinding,
  dimensionBindings,
  resolveDimensionRanges,
  selectionKeyOf,
  useManipulation,
} from "./manipulation";

/**
 * The pure grouping / binding / clamp helpers behind the immersive editor
 * (ADR 0116). The interactive behaviour is covered by the overlay/dock suites;
 * this file pins the maths those depend on.
 */
describe("selectionKeyOf", () => {
  it("drops the trailing piece segment to name the part", () => {
    expect(selectionKeyOf("preview/fill/3")).toBe("preview/fill");
  });

  it("handles a two-segment id and a bare id", () => {
    expect(selectionKeyOf("preview/frame")).toBe("preview");
    expect(selectionKeyOf("solo")).toBe("solo");
  });

  it("is consistent for two pieces of the same part", () => {
    expect(selectionKeyOf("preview/fill/1")).toBe(selectionKeyOf("preview/fill/9"));
  });
});

describe("clampToBinding", () => {
  const binding = { key: "w", label: "Šířka", value: 4000, min: 2000, max: 8000, step: 10 };

  it("clamps to the range domain rail", () => {
    expect(clampToBinding(binding, 1500)).toBe(2000);
    expect(clampToBinding(binding, 9000)).toBe(8000);
  });

  it("passes an in-domain value through — a constraint breach is still a valid drag target", () => {
    expect(clampToBinding(binding, 6400)).toBe(6400);
  });
});

describe("dimensionBindings", () => {
  const w = { key: "opening_width_mm", label: "Šířka otvoru", min: 2000, max: 8000, step: 10 };
  const h = { key: "clear_height_mm", label: "Průjezdná výška", min: 800, max: 2500, step: 10 };

  it("binds the caller's width/height pair, reading their values", () => {
    const read = (key: string) => (key === "opening_width_mm" ? 4000 : 1800);
    const { width, height } = dimensionBindings({ width: w, height: h }, read);
    expect(width).toMatchObject({ key: "opening_width_mm", value: 4000, min: 2000, max: 8000 });
    expect(height).toMatchObject({ key: "clear_height_mm", value: 1800 });
  });

  it("yields a null binding when the value cannot be read (no pill is then shown)", () => {
    const { width, height } = dimensionBindings({ width: w, height: h }, (key) =>
      key === "opening_width_mm" ? 4000 : null,
    );
    expect(width).not.toBeNull();
    expect(height).toBeNull();
  });

  it("yields null for a dimension the release does not author", () => {
    const { width, height } = dimensionBindings({ width: w }, () => 4000);
    expect(width).not.toBeNull();
    expect(height).toBeNull();
  });
});

/**
 * The role-vs-position resolution the immersive layer runs before it binds
 * (ADR 0136). BOTH paths are pinned: an authored release binds by role wherever
 * the parameters sit, and a role-less release (every release published before
 * that ADR) still binds positionally.
 */
describe("resolveDimensionRanges — role first, position as fallback", () => {
  const param = (key: string, extra?: Partial<ParameterDef>): ParameterDef => ({
    key,
    type: "length_mm",
    adjustability: "user",
    domain: { kind: "range", min: 100, max: 900, step: 10 },
    ...extra,
  });

  /** One step, one group, every parameter visible — the shape `resolveUi` hands
   *  `ConfiguratorInner`. */
  const steps = (params: { def: ParameterDef; visible?: boolean }[]): ResolvedUiStep[] => [
    {
      id: "s",
      groups: [
        { id: "g", params: params.map((p) => ({ def: p.def, visible: p.visible ?? true })) },
      ],
    },
  ];

  it("prefers the authored roles over declaration order", () => {
    // `ground_elevation_mm` is declared FIRST and is a perfectly good bounded
    // range — the ADR 0117 positional heuristic would have made it the width.
    const resolved = resolveDimensionRanges(
      steps([
        { def: param("ground_elevation_mm") },
        { def: param("clear_height_mm", { dimensionRole: "height" }) },
        { def: param("opening_width_mm", { dimensionRole: "width" }) },
      ]),
    );
    expect(resolved.width?.key).toBe("opening_width_mm");
    expect(resolved.height?.key).toBe("clear_height_mm");
  });

  it("falls back to position for a release that authors no role at all", () => {
    const resolved = resolveDimensionRanges(
      steps([
        { def: param("opening_width_mm") },
        { def: param("clear_height_mm") },
        { def: param("ground_elevation_mm") },
      ]),
    );
    expect(resolved.width?.key).toBe("opening_width_mm");
    expect(resolved.height?.key).toBe("clear_height_mm");
  });

  it("does NOT back-fill the missing half of a partly-authored release", () => {
    // Only the width is nominated: the height pill is absent rather than being
    // guessed from a parameter the vendor did not name (§7.6).
    const resolved = resolveDimensionRanges(
      steps([
        { def: param("opening_width_mm", { dimensionRole: "width" }) },
        { def: param("ground_elevation_mm") },
      ]),
    );
    expect(resolved.width?.key).toBe("opening_width_mm");
    expect(resolved.height).toBeUndefined();
  });

  it("skips a hidden or unbounded parameter — a drag needs a visible rail", () => {
    const resolved = resolveDimensionRanges(
      steps([
        { def: param("hidden_width_mm", { dimensionRole: "width" }), visible: false },
        { def: param("open_ended_mm", { domain: { kind: "range", min: 100 } }) },
        { def: param("clear_height_mm", { dimensionRole: "height" }) },
      ]),
    );
    expect(resolved.width).toBeUndefined();
    expect(resolved.height?.key).toBe("clear_height_mm");
  });

  it("yields nothing when the release has no bounded range parameter at all", () => {
    expect(resolveDimensionRanges(steps([]))).toEqual({ width: undefined, height: undefined });
  });
});

describe("useManipulation immersive lifecycle", () => {
  it("clears the selection and drag when immersive is turned off", () => {
    useManipulation.setState({
      immersive: true,
      selected: "preview/fill",
      drag: { key: "opening_width_mm", value: 4000 },
    });
    useManipulation.getState().setImmersive(false);
    const s = useManipulation.getState();
    expect(s.immersive).toBe(false);
    expect(s.selected).toBeNull();
    expect(s.drag).toBeNull();
  });

  it("keeps the selection when entering immersive", () => {
    useManipulation.setState({ immersive: false, selected: "preview/fill" });
    useManipulation.getState().setImmersive(true);
    expect(useManipulation.getState().selected).toBe("preview/fill");
  });

  it("toggleImmersive off also clears the selection", () => {
    useManipulation.setState({ immersive: true, selected: "preview/frame" });
    useManipulation.getState().toggleImmersive();
    expect(useManipulation.getState().immersive).toBe(false);
    expect(useManipulation.getState().selected).toBeNull();
  });
});
