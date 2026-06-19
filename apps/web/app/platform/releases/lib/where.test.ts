/**
 * Exhaustive bijection: every Phase-1 expression slot `slotScopes` produces for
 * the authored corpus must be reproducible by a `where.ts` builder from the
 * release's own keys (so no live defect can ever land on the wrong field), and
 * every where a builder produces must be a real `slotScopes` key (so the editor
 * never reads a defect slot the gate doesn't emit).
 */
import { describe, expect, it } from "vitest";

import { fenceRunV1, slidingGateV1 } from "@repo/fixtures";
import { slotScopes } from "@repo/model";
import type { ProductModelRelease } from "@repo/model";

import {
  whereConstraint,
  whereDerived,
  whereParamDefaultExpr,
  whereParamDeviationBound,
  whereParamRelevance,
} from "./where";

/** The wheres the editor's builders produce for a release's Phase-1 expr slots. */
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
  return produced;
}

/** slotScopes keys for the Phase-1 sections (parameters / constraints / derived). */
function phase1ScopeKeys(release: ProductModelRelease): string[] {
  return [...slotScopes(release).keys()].filter(
    (k) => k.startsWith("parameters[") || k.startsWith("constraints[") || k.startsWith("derived["),
  );
}

describe("where ↔ slotScopes bijection (Phase 1)", () => {
  for (const release of [slidingGateV1, fenceRunV1]) {
    describe(release.id, () => {
      const scopeKeys = new Set(slotScopes(release).keys());
      const produced = producedWheres(release);

      it("every builder-produced where is a real slotScopes key", () => {
        for (const w of produced) expect(scopeKeys.has(w)).toBe(true);
      });

      it("every Phase-1 expr slot is reproducible by a builder", () => {
        for (const k of phase1ScopeKeys(release)) expect(produced.has(k)).toBe(true);
      });
    });
  }
});
