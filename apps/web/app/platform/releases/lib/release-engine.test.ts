/**
 * The editor's pure compute core (ADR 0068 Phase 4) — the worker and the
 * main-thread fallback both run this. Locks: a well-formed draft validates clean
 * with per-slot scopes; a bad expression surfaces a `where`-addressed defect; a
 * malformed JSON island becomes one island defect (never a throw); the result is
 * structured-clone safe so it can cross the worker boundary.
 */
import { describe, expect, it } from "vitest";

import { catalogV2, siteGateConfig, sitePrices, slidingGateV1 } from "@repo/fixtures";

import { blankConstraint, blankDraft, blankParam, draftFromRelease } from "./draft";
import { runReleasePreview, runReleaseValidation } from "./release-engine";
import { type ReleaseDraftInput } from "./section-schemas";

function draft(over: Partial<ReleaseDraftInput>): ReleaseDraftInput {
  return { ...blankDraft(), modelId: "m", ...over };
}

describe("runReleaseValidation", () => {
  it("validates a well-formed draft (only the I2 fixtures.empty defect) and exposes per-slot scopes", () => {
    const v = runReleaseValidation(
      draft({
        parameters: [{ ...blankParam(), key: "width_mm", type: "length_mm" }],
        derived: [{ key: "half_mm", expr: "width_mm / 2" }],
      }),
      null,
    );
    // The editor does not author golden fixtures yet (ADR 0068 follow-up "0.2b"),
    // so every draft-built release carries exactly the I2 `fixtures.empty` defect
    // until then — and NOTHING else (the params/derived slots are clean).
    expect(v.defects.map((d) => d.code)).toEqual(["fixtures.empty"]);
    expect(v.errorCount).toBe(1);
    expect(v.release).not.toBeNull();
    // slotScopes keyed by the validator's `where`; the derived slot sees width_mm.
    const scope = v.scopes.get("derived[half_mm]");
    expect(scope?.known.has("width_mm")).toBe(true);
  });

  it("surfaces an unparseable expression as a where-addressed defect", () => {
    const v = runReleaseValidation(draft({ derived: [{ key: "bad", expr: "1 +" }] }), null);
    expect(v.errorCount).toBeGreaterThan(0);
    expect(v.defectsByWhere.get("derived[bad]")?.length).toBeGreaterThan(0);
  });

  it("turns a malformed JSON island into one island defect, not a throw", () => {
    const v = runReleaseValidation(draft({ uiJson: "{ not json" }), null);
    expect(v.defects.some((d) => d.where === "ui")).toBe(true);
  });

  it("returns a structured-clone-safe snapshot (worker boundary)", () => {
    const v = runReleaseValidation(
      draft({
        parameters: [{ ...blankParam(), key: "w", type: "length_mm" }],
        constraints: [{ ...blankConstraint(), key: "c", expr: "w > 0" }],
      }),
      null,
    );
    // structuredClone throws on functions / class instances — proves the
    // Map/Set/ExprString payload survives postMessage.
    expect(() => structuredClone(v)).not.toThrow();
  });

  it("is empty for a draft that fails the form schema", () => {
    // version must be a non-negative int; a negative coerces to a parse failure.
    const v = runReleaseValidation(draft({ version: -1 }), null);
    expect(v).toEqual({
      scopes: new Map(),
      defectsByWhere: new Map(),
      defects: [],
      errorCount: 0,
      release: null,
    });
  });
});

describe("runReleasePreview", () => {
  // The golden gate, round-tripped through the editor's draft form, must still
  // derive to its delta-0 total — the preview path reproduces the published one.
  const gateDraft = draftFromRelease(slidingGateV1, slidingGateV1.version, catalogV2.version);

  it("derives the in-progress release on a sample input (golden reproduces)", () => {
    const p = runReleasePreview(gateDraft, siteGateConfig, catalogV2, sitePrices, null);
    expect(p.status).toBe("ok");
    if (p.status !== "ok") return;
    expect(p.result.isValid).toBe(true);
    expect(p.result.money.total).toBe("81451.504");
    expect(p.result.parts.length).toBeGreaterThan(0);
    expect(p.scope).not.toBeNull();
  });

  it("is unavailable without a catalog (resolution needs one)", () => {
    expect(runReleasePreview(gateDraft, siteGateConfig, null, sitePrices, null)).toEqual({
      status: "no-catalog",
    });
  });

  it("is unavailable without a price table (a missing price is an I5 error, not a zero)", () => {
    expect(runReleasePreview(gateDraft, siteGateConfig, catalogV2, null, null)).toEqual({
      status: "no-prices",
    });
  });

  it("reports no-release when the form shape is invalid", () => {
    const bad = { ...gateDraft, version: -1 };
    expect(runReleasePreview(bad, siteGateConfig, catalogV2, sitePrices, null)).toEqual({
      status: "no-release",
    });
  });

  it("returns a structured-clone-safe snapshot (worker boundary)", () => {
    const p = runReleasePreview(gateDraft, siteGateConfig, catalogV2, sitePrices, null);
    expect(() => structuredClone(p)).not.toThrow();
  });
});
