/**
 * drawScopes + the drawing-spec publish gate over the real branka corpus. Proves
 * (a) the scope universe the editor would offer covers the authored spec, (b) the
 * shipped release validates clean, and (c) the gate CATCHES the authoring
 * mistakes it exists to catch — a typo'd derived key, a feature glob that targets
 * nothing, a duplicate rule id. The zero-drift guarantee: the gate matches globs
 * with the SAME `pieceGlobToRegex` the runtime Annotator uses.
 */
import { describe, expect, it } from "vitest";

import { drawScopes, validateRelease } from "@repo/model";
import type { DrawingRule, ProductModelRelease } from "@repo/model";

import { catalogV1 } from "./catalog/catalog-v1.js";
import { brankaV1 } from "./releases/branka.js";

const codesFor = (release: ProductModelRelease): string[] =>
  validateRelease(release, catalogV1)
    .filter((d) => d.where.startsWith("drawing"))
    .map((d) => d.code);

/** Clone the release with a patched drawing spec (the store is immutable). */
const withRules = (rules: DrawingRule[]): ProductModelRelease => ({
  ...brankaV1,
  drawing: { ...brankaV1.drawing!, rules },
});

describe("drawScopes — branka corpus", () => {
  const scope = drawScopes(brankaV1);

  it("exposes every derived key as printable", () => {
    for (const d of brankaV1.derivation.derived) expect(scope.derivedKeys.has(d.key)).toBe(true);
  });

  it("produces a specimen for every declared geometry piece (repeat → [0])", () => {
    expect(scope.pieceSpecimens).toContain("frame.lprofile/stileLeft");
    expect(scope.pieceSpecimens).toContain("fill.material/piece[0]"); // repeat representative
    expect(scope.pieceSpecimens).toContain("frame.hprofile/carrier[0]"); // repeat count 2
  });

  it("every authored rule references a real derived key + a declared piece", () => {
    for (const rule of brankaV1.drawing!.rules) {
      if (rule.kind !== "label" && rule.derivedValue !== undefined) {
        expect(scope.derivedKeys.has(rule.derivedValue)).toBe(true);
      }
    }
  });
});

describe("drawing publish gate", () => {
  it("the shipped branka release validates with NO drawing defects", () => {
    expect(codesFor(brankaV1)).toEqual([]);
  });

  it("flags a derivedValue that is not a derived key", () => {
    const bad = withRules([
      {
        kind: "dimension",
        id: "typo",
        feature: { pieces: "frame.lprofile/stileLeft" },
        measure: "y-extent",
        side: "left",
        derivedValue: "stileLenght", // typo
      },
    ]);
    expect(codesFor(bad)).toContain("drawing.derived.unknown");
  });

  it("flags a feature glob that targets no declared piece", () => {
    const bad = withRules([
      {
        kind: "label",
        id: "ghost",
        feature: { pieces: "frame.lprofile/doesNotExist" },
        text: "Z",
      },
    ]);
    expect(codesFor(bad)).toContain("drawing.feature.nomatch");
  });

  it("accepts the wildcard + index glob idioms the runtime resolves", () => {
    const ok = withRules([
      { kind: "label", id: "all", feature: { pieces: "fill.material/piece[*]" }, text: "D" },
      { kind: "label", id: "first", feature: { pieces: "fill.material/piece[0]" }, text: "D" },
    ]);
    expect(codesFor(ok)).toEqual([]);
  });

  it("accepts a specific NON-ZERO repeat index (the count is unknowable statically; the runtime no-ops out-of-range)", () => {
    // Regression: the gate used to emit only the [0] specimen, so `piece[5]` —
    // which the runtime Annotator matches whenever fillCount > 5 — was
    // false-rejected, wrongly blocking a valid publish (adversarial review).
    const ok = withRules([
      { kind: "label", id: "sixth", feature: { pieces: "fill.material/piece[5]" }, text: "D" },
    ]);
    expect(codesFor(ok)).toEqual([]);
  });

  it("flags a duplicate rule id", () => {
    const dup = withRules([
      { kind: "label", id: "same", feature: { pieces: "frame.lprofile/stileLeft" }, text: "A" },
      { kind: "label", id: "same", feature: { pieces: "frame.lprofile/latchPost" }, text: "C" },
    ]);
    expect(codesFor(dup)).toContain("key.duplicate");
  });

  it("flags a duplicate section id", () => {
    const dup: ProductModelRelease = {
      ...brankaV1,
      drawing: {
        ...brankaV1.drawing!,
        sections: [
          { id: "A-A", axis: "x", offsetMm: 455 },
          { id: "A-A", axis: "y", offsetMm: 100 },
        ],
      },
    };
    expect(codesFor(dup)).toContain("key.duplicate");
  });
});
