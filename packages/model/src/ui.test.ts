/**
 * resolveUi (CORE_SPEC §8): the generated surface is a pure function of
 * (release, scope) — structure from UiSpec, visibility from `relevance`,
 * fail-open when relevance cannot evaluate (the UI flavor of I5).
 */
import { describe, expect, it } from "vitest";

import { expr } from "./expr.js";
import type { ProductModelRelease } from "./schema.js";
import { defaultUi, resolveUi } from "./ui.js";

const release: ProductModelRelease = {
  id: "t@1",
  modelId: "t",
  version: 1,
  status: "draft",
  parameters: [
    { key: "width", label: "Šířka", type: "length_mm", adjustability: "user" },
    { key: "motor", type: "bool", default: true, adjustability: "user" },
    {
      key: "motor_type",
      type: "select",
      adjustability: "user",
      relevance: expr("motor"),
    },
    {
      key: "needs_option_attr",
      type: "int",
      adjustability: "tenant",
      relevance: expr("fill.profile_mm > 100"),
    },
    { key: "internal", type: "int", default: 1, adjustability: "vendor" },
  ],
  constraints: [],
  derivation: { derived: [], parts: [] },
  ui: {
    steps: [
      {
        id: "dims",
        label: "Rozměry",
        groups: [{ id: "main", label: "Hlavní", params: ["width"] }],
      },
      {
        id: "drive",
        groups: [{ id: "drive", params: ["motor", "motor_type", "needs_option_attr"] }],
      },
    ],
  },
};

describe("resolveUi", () => {
  it("returns the authored structure with labels and definitions", () => {
    const steps = resolveUi(release, { width: 4000, motor: true });
    expect(steps.map((s) => s.id)).toEqual(["dims", "drive"]);
    expect(steps[0]!.label).toBe("Rozměry");
    expect(steps[0]!.groups[0]!.params[0]!.def.label).toBe("Šířka");
  });

  it("flips visibility with the relevance expression", () => {
    const on = resolveUi(release, { motor: true });
    const off = resolveUi(release, { motor: false });
    const motorType = (steps: typeof on) =>
      steps[1]!.groups[0]!.params.find((p) => p.def.key === "motor_type")!;
    expect(motorType(on).visible).toBe(true);
    expect(motorType(off).visible).toBe(false);
  });

  it("fails open when relevance cannot evaluate against the scope", () => {
    // `fill.profile_mm` is absent (no option chosen yet) — hiding here would
    // silently amputate the surface, so the parameter stays visible.
    const steps = resolveUi(release, { motor: true });
    const p = steps[1]!.groups[0]!.params.find((x) => x.def.key === "needs_option_attr")!;
    expect(p.visible).toBe(true);
  });

  it("keeps stable step/group structure regardless of visibility", () => {
    const steps = resolveUi(release, { motor: false });
    expect(steps).toHaveLength(2);
    expect(steps[1]!.groups[0]!.params).toHaveLength(3);
  });

  it("falls back to one step over all writable parameters without ui", () => {
    const bare: ProductModelRelease = { ...release, ui: undefined };
    const steps = resolveUi(bare, {});
    expect(steps).toHaveLength(1);
    const keys = steps[0]!.groups[0]!.params.map((p) => p.def.key);
    expect(keys).toEqual(["width", "motor", "motor_type", "needs_option_attr"]);
    expect(defaultUi(bare).steps[0]!.groups[0]!.params).not.toContain("internal");
  });
});
