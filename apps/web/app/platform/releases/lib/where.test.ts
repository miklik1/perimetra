/**
 * Exhaustive bijection: every expression slot `slotScopes` produces for the
 * authored corpus must be reproducible by a `where.ts` builder from the release's
 * own keys (so no live defect can ever land on the wrong field), and every where
 * a builder produces must be a real `slotScopes` key (so the editor never reads a
 * defect slot the gate doesn't emit). Phase 1 = parameters/constraints/derived;
 * Phase 2 = parts/geometry (keyed by part `path` + geometry `key`).
 */
import { describe, expect, it } from "vitest";

import { fenceRunV1, slidingGateV1 } from "@repo/fixtures";
import { slotScopes } from "@repo/model";
import type { ProductModelRelease } from "@repo/model";

import {
  whereConstraint,
  whereDerived,
  whereGeometryAt,
  whereGeometryCut,
  whereGeometryLength,
  whereGeometryRepeatCount,
  whereGeometryRotation,
  whereParamDefaultExpr,
  whereParamDeviationBound,
  whereParamRelevance,
  wherePartBom,
  wherePartResolveMaterial,
  wherePartResolveSection,
  wherePartWhen,
  type Axis,
} from "./where";

/** The wheres the editor's builders produce for a release's EXPR slots — mirrors
 *  `slotScopes`' exact per-field conditionality (a slot keys only when present). */
function producedWheres(release: ProductModelRelease): Set<string> {
  const produced = new Set<string>();
  for (const p of release.parameters) {
    if (p.defaultExpr !== undefined) produced.add(whereParamDefaultExpr(p.key));
    if (p.relevance !== undefined) produced.add(whereParamRelevance(p.key));
    if (p.deviation?.bounds) {
      produced.add(whereParamDeviationBound(p.key, "min"));
      produced.add(whereParamDeviationBound(p.key, "max"));
    }
  }
  for (const c of release.constraints) produced.add(whereConstraint(c.key));
  for (const d of release.derivation.derived) produced.add(whereDerived(d.key));

  for (const rule of release.derivation.parts) {
    const path = rule.path;
    if (rule.when !== undefined) produced.add(wherePartWhen(path));
    if (rule.resolve.section !== undefined) produced.add(wherePartResolveSection(path));
    if (rule.resolve.material !== undefined) produced.add(wherePartResolveMaterial(path));
    produced.add(wherePartBom(path, "quantity"));
    if (rule.bom.lengthMm !== undefined) produced.add(wherePartBom(path, "lengthMm"));
    if (rule.bom.pricePerUnit !== undefined) produced.add(wherePartBom(path, "pricePerUnit"));
    if (rule.bom.totalPrice !== undefined) produced.add(wherePartBom(path, "totalPrice"));
    for (const geo of rule.geometry ?? []) {
      if (geo.repeat !== undefined) produced.add(whereGeometryRepeatCount(path, geo.key));
      produced.add(whereGeometryLength(path, geo.key));
      geo.at.forEach((_, i) => produced.add(whereGeometryAt(path, geo.key, i as Axis)));
      geo.rotation?.forEach((_, i) =>
        produced.add(whereGeometryRotation(path, geo.key, i as Axis)),
      );
      if (geo.cuts?.left !== undefined) produced.add(whereGeometryCut(path, geo.key, "left"));
      if (geo.cuts?.right !== undefined) produced.add(whereGeometryCut(path, geo.key, "right"));
    }
  }
  return produced;
}

describe("where ↔ slotScopes bijection", () => {
  for (const release of [slidingGateV1, fenceRunV1]) {
    describe(release.id, () => {
      const scopeKeys = new Set(slotScopes(release).keys());
      const produced = producedWheres(release);

      it("every builder-produced where is a real slotScopes key", () => {
        for (const w of produced) expect(scopeKeys.has(w)).toBe(true);
      });

      it("every structured-section expr slot is reproducible by a builder", () => {
        // Ports stay a raw-JSON island (Phase 4); every OTHER slotScopes slot is
        // a structured field and must round-trip through a builder.
        const structured = [...scopeKeys].filter((k) => !k.startsWith("ports["));
        for (const k of structured) expect(produced.has(k)).toBe(true);
      });
    });
  }
});
