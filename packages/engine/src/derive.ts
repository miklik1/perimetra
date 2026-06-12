/**
 * Derivation (CORE_SPEC §3) — config → assembly graph, the heart of the engine
 * and the only compute path (I4). Named dimensions are evaluated in order
 * (each may reference earlier ones), then part rules expand into parts with
 * stable, recipe-path ids (I9). Every part's component is resolved from the
 * catalog via its rule's {role, section, material} request (CORE_SPEC §2) —
 * recipes never name component codes. Pure: no clock, no randomness, no I/O (I1).
 */
import { evalBoolean, evalNumber, evalString, type Catalog, type Scope } from "@repo/model";
import type { ExprString, ProductModelRelease } from "@repo/model";

import { resolveComponent, type ResolutionRequest } from "./resolve";
import type { AssemblyGraph, Issue, Part } from "./types";

/** Resolution failures are collected (the full vendor worklist, not just the
 *  first gap) and fail the derivation — no partial BOM ever ships (I5). */
export interface DeriveOutcome extends AssemblyGraph {
  issues: Issue[];
}

/** Evaluate an optional request axis; a non-string result is an authoring bug. */
function evalAxis(source: ExprString | undefined, scope: Scope, where: string): string | undefined {
  if (source === undefined) return undefined;
  const value = evalString(source, scope);
  if (typeof value !== "string") {
    throw new TypeError(`resolve.${where} must evaluate to a string, got ${typeof value}`);
  }
  return value;
}

export function derive(
  release: ProductModelRelease,
  baseScope: Scope,
  catalog: Catalog,
): DeriveOutcome {
  // Work on a copy so the caller's scope is not mutated (determinism hygiene).
  const scope: Scope = { ...baseScope };
  const derived: Record<string, number> = {};

  for (const def of release.derivation.derived) {
    const value = evalNumber(def.expr, scope);
    scope[def.key] = value;
    derived[def.key] = value;
  }

  const parts: Part[] = [];
  const issues: Issue[] = [];
  for (const rule of release.derivation.parts) {
    if (rule.when !== undefined && !evalBoolean(rule.when, scope)) continue;

    const request: ResolutionRequest = { role: rule.resolve.role };
    const section = evalAxis(rule.resolve.section, scope, `section of "${rule.path}"`);
    if (section !== undefined) request.section = section;
    const material = evalAxis(rule.resolve.material, scope, `material of "${rule.path}"`);
    if (material !== undefined) request.material = material;

    const outcome = resolveComponent(catalog, request);
    if (!outcome.ok) {
      issues.push(outcome.issue);
      continue;
    }
    const component = outcome.component;
    if (component.unit !== rule.bom.unit) {
      // Catalog↔release data disagreement — author-time, no user input causes it.
      throw new TypeError(
        `Unit mismatch at "${rule.path}": component "${component.code}" is per ` +
          `${component.unit}, the rule bills per ${rule.bom.unit}`,
      );
    }

    const part: Part = {
      path: rule.path,
      componentCode: component.code,
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

  return { derived, parts, issues };
}
