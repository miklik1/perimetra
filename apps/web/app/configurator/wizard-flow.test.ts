import { describe, expect, it } from "vitest";

import type { ResolvedUiStep } from "@repo/model";

import { buildFlow, flowKey } from "./wizard-flow";

const steps: ResolvedUiStep[] = [
  { id: "rozmery", label: "Rozměry", groups: [{ id: "otvor", params: [] }] },
  { id: "konstrukce", label: "Konstrukce", groups: [{ id: "ram", params: [] }] },
  { id: "vybava", label: "Výbava", groups: [{ id: "pohon", params: [] }] },
];

describe("buildFlow", () => {
  it("wraps the release's OWN steps one-to-one in the three shell steps", () => {
    const flow = buildFlow(steps);
    expect(flow.map((s) => s.kind)).toEqual([
      "produkt",
      "release",
      "release",
      "release",
      "barva",
      "souhrn",
    ]);
  });

  it("carries each release step's authored id and label through unchanged", () => {
    const flow = buildFlow(steps);
    const authored = flow.filter((s) => s.kind === "release");
    expect(authored.map((s) => s.id)).toEqual(["rozmery", "konstrukce", "vybava"]);
    expect(authored.map((s) => s.label)).toEqual(["Rozměry", "Konstrukce", "Výbava"]);
  });

  it("keeps each release step's own groups rather than flattening them together", () => {
    const flow = buildFlow(steps);
    expect(flow.filter((s) => s.kind === "release").map((s) => s.groups.map((g) => g.id))).toEqual([
      ["otvor"],
      ["ram"],
      ["pohon"],
    ]);
  });

  it("gives the site plan and the hero pose to the FIRST release step only", () => {
    const flow = buildFlow(steps);
    const authored = flow.filter((s) => s.kind === "release");
    expect(authored.map((s) => s.plan)).toEqual([true, false, false]);
    expect(authored.map((s) => s.view)).toEqual(["hero", "detail", "detail"]);
  });

  it("keeps the ADR 0077 poses on the shell steps, and never the site plan", () => {
    const flow = buildFlow(steps);
    const shell = (kind: string) => flow.find((s) => s.kind === kind)!;
    expect(shell("produkt").view).toBe("hero");
    expect(shell("barva").view).toBe("front");
    expect(shell("souhrn").view).toBe("pullback");
    for (const kind of ["produkt", "barva", "souhrn"]) {
      expect(shell(kind).plan).toBe(false);
    }
  });

  it("leaves the shell steps (produkt/barva/souhrn) free of release groups and labels", () => {
    const flow = buildFlow(steps);
    for (const kind of ["produkt", "barva", "souhrn"] as const) {
      expect(flow.find((s) => s.kind === kind)!.groups).toEqual([]);
      expect(flow.find((s) => s.kind === kind)!.label).toBeUndefined();
    }
  });

  it("degrades to the three shell steps plus one when the release authored a single step", () => {
    const flow = buildFlow([steps[0]!]);
    expect(flow.map((s) => s.kind)).toEqual(["produkt", "release", "barva", "souhrn"]);
    const only = flow.find((s) => s.kind === "release")!;
    expect(only.plan).toBe(true);
    expect(only.groups).toHaveLength(1);
  });

  it("degrades to the shell alone when the release authored no steps at all", () => {
    const flow = buildFlow([]);
    expect(flow.map((s) => s.kind)).toEqual(["produkt", "barva", "souhrn"]);
  });

  it("keys every step uniquely even when a release authors a step id that shadows a shell step", () => {
    // Publish validation enforces step-id uniqueness only WITHIN a spec, so a
    // release is free to author a step called "produkt". Keying nav on the bare
    // id would then make two flow steps indistinguishable and the nav would jump
    // to the wrong one.
    const flow = buildFlow([
      { id: "produkt", label: "Produkt (autorský)", groups: [] },
      { id: "souhrn", label: "Souhrn (autorský)", groups: [] },
    ]);
    const keys = flow.map(flowKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      "produkt:produkt",
      "release:produkt",
      "release:souhrn",
      "barva:barva",
      "souhrn:souhrn",
    ]);
  });

  it("leaves an unlabelled release step's label undefined, for the caller to fall back on the id", () => {
    const flow = buildFlow([{ id: "bez-popisku", groups: [] }]);
    const only = flow.find((s) => s.kind === "release")!;
    expect(only.label).toBeUndefined();
    expect(only.id).toBe("bez-popisku");
  });
});
