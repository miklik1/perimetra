import { describe, expect, it } from "vitest";

import { clampToBinding, dimensionBindings, selectionKeyOf, useManipulation } from "./manipulation";

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
  const ranges = [
    { key: "opening_width_mm", label: "Šířka otvoru", min: 2000, max: 8000, step: 10 },
    { key: "clear_height_mm", label: "Průjezdná výška", min: 800, max: 2500, step: 10 },
  ];

  it("binds the first two ranges to width and height, reading their values", () => {
    const read = (key: string) => (key === "opening_width_mm" ? 4000 : 1800);
    const { width, height } = dimensionBindings(ranges, read);
    expect(width).toMatchObject({ key: "opening_width_mm", value: 4000, min: 2000, max: 8000 });
    expect(height).toMatchObject({ key: "clear_height_mm", value: 1800 });
  });

  it("yields a null binding when the value cannot be read (no pill is then shown)", () => {
    const { width, height } = dimensionBindings(ranges, (key) =>
      key === "opening_width_mm" ? 4000 : null,
    );
    expect(width).not.toBeNull();
    expect(height).toBeNull();
  });

  it("yields null for a dimension the release does not author", () => {
    const { width, height } = dimensionBindings([ranges[0]!], () => 4000);
    expect(width).not.toBeNull();
    expect(height).toBeNull();
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
