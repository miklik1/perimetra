import { describe, expect, it } from "vitest";

import { sceneById, SCENES } from "./scenes";

describe("sceneById", () => {
  it("returns the matching preset", () => {
    expect(sceneById("prijezd").label).toBe("Příjezd");
    expect(sceneById("prijezd").context).toBe("pillars");
  });

  it("falls back to studio for an unknown id", () => {
    expect(sceneById("nope").id).toBe("studio");
  });

  it("studio is the neutral default: a floor but no context geometry (ADR 0095)", () => {
    // Studio gained a real ground plane — a gate over a void reads as floating
    // (the configurator's "models floating in air" defect). It still carries no
    // pillars/fence/hedge context (that's what distinguishes it from the others).
    const studio = sceneById("studio");
    expect(studio.ground).not.toBeNull();
    expect(studio.context).toBe("none");
  });

  it("every scene carries a visible ground (no scene floats the gate)", () => {
    for (const s of SCENES) {
      expect(s.ground).not.toBeNull();
    }
  });
});
