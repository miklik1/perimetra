/**
 * Derivation (CORE_SPEC §3) — config → assembly graph, the heart of the engine
 * and the only compute path (I4). Named dimensions are evaluated in order
 * (each may reference earlier ones), then part rules expand into parts with
 * stable, recipe-path ids (I9). Pure: no clock, no randomness, no I/O (I1).
 */
import { evalBoolean, evalNumber, evalString, type Scope } from "@repo/model";
import type { ProductModelRelease } from "@repo/model";

import type { AssemblyGraph, Part } from "./types";

export function derive(release: ProductModelRelease, baseScope: Scope): AssemblyGraph {
  // Work on a copy so the caller's scope is not mutated (determinism hygiene).
  const scope: Scope = { ...baseScope };
  const derived: Record<string, number> = {};

  for (const def of release.derivation.derived) {
    const value = evalNumber(def.expr, scope);
    scope[def.key] = value;
    derived[def.key] = value;
  }

  const parts: Part[] = [];
  for (const rule of release.derivation.parts) {
    if (rule.when !== undefined && !evalBoolean(rule.when, scope)) continue;

    let componentCode = rule.componentCode;
    if (rule.componentCodeExpr !== undefined) {
      const resolved = evalString(rule.componentCodeExpr, scope);
      if (typeof resolved !== "string") {
        throw new TypeError(
          `componentCodeExpr for "${rule.path}" must evaluate to a string, got ${typeof resolved}`,
        );
      }
      componentCode = resolved;
    }

    const part: Part = {
      path: rule.path,
      componentCode,
      name: rule.name,
      unit: rule.bom.unit,
      quantity: evalNumber(rule.bom.quantity, scope),
      category: rule.bom.category,
    };
    if (rule.bom.lengthMm !== undefined) {
      part.lengthMm = evalNumber(rule.bom.lengthMm, scope);
    }
    if (rule.bom.pricePerUnit !== undefined) {
      part.pricePerUnit = evalNumber(rule.bom.pricePerUnit, scope);
    }
    if (rule.bom.totalPrice !== undefined) {
      part.totalPrice = evalNumber(rule.bom.totalPrice, scope);
    }
    parts.push(part);
  }

  return { derived, parts };
}
