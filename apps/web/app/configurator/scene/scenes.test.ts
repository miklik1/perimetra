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

  it("studio is the invisible default (no ground, no context)", () => {
    const studio = sceneById("studio");
    expect(studio.ground).toBeNull();
    expect(studio.context).toBe("none");
  });

  it("every non-studio scene carries a visible ground", () => {
    for (const s of SCENES) {
      if (s.id === "studio") continue;
      expect(s.ground).not.toBeNull();
    }
  });
});
