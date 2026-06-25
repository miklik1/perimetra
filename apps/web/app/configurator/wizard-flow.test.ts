import { describe, expect, it } from "vitest";

import type { ResolvedUiStep } from "@repo/model";

import { buildFlow } from "./wizard-flow";

const steps: ResolvedUiStep[] = [
  { id: "rozmery", label: "Rozměry", groups: [{ id: "otvor", params: [] }] },
  { id: "konstrukce", label: "Konstrukce", groups: [{ id: "ram", params: [] }] },
  { id: "vybava", label: "Výbava", groups: [{ id: "pohon", params: [] }] },
];

describe("buildFlow", () => {
  it("is always the fixed 5-step brand spine in order", () => {
    const flow = buildFlow(steps);
    expect(flow.map((s) => s.kind)).toEqual([
      "produkt",
      "lokalita",
      "konfigurace",
      "barva",
      "souhrn",
    ]);
  });

  it("seeds Lokalita from the release's FIRST authored step", () => {
    const flow = buildFlow(steps);
    const lokalita = flow.find((s) => s.kind === "lokalita")!;
    expect(lokalita.groups.map((g) => g.id)).toEqual(["otvor"]);
  });

  it("seeds Konfigurace from ALL the remaining authored steps", () => {
    const flow = buildFlow(steps);
    const konfigurace = flow.find((s) => s.kind === "konfigurace")!;
    expect(konfigurace.groups.map((g) => g.id)).toEqual(["ram", "pohon"]);
  });

  it("leaves the shell steps (produkt/barva/souhrn) free of release groups", () => {
    const flow = buildFlow(steps);
    for (const kind of ["produkt", "barva", "souhrn"] as const) {
      expect(flow.find((s) => s.kind === kind)!.groups).toEqual([]);
    }
  });

  it("degrades safely when the release authored a single step (Konfigurace empty)", () => {
    const flow = buildFlow([steps[0]!]);
    expect(flow.find((s) => s.kind === "lokalita")!.groups).toHaveLength(1);
    expect(flow.find((s) => s.kind === "konfigurace")!.groups).toHaveLength(0);
  });
});
