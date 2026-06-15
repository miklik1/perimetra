/**
 * Derivation (CORE_SPEC §3) — config → assembly graph, the heart of the engine
 * and the only compute path (I4). Named dimensions are evaluated in order
 * (each may reference earlier ones), then part rules expand into parts with
 * stable, recipe-path ids (I9). Every part's component is resolved from the
 * catalog via its rule's {role, section, material} request (CORE_SPEC §2) —
 * recipes never name component codes. Pure: no clock, no randomness, no I/O (I1).
 */
import { evalBoolean, evalNumber, evalString, type Catalog, type Scope } from "@repo/model";
import type { Component, ExprString, PartRule, ProductModelRelease } from "@repo/model";

import { resolveComponent, type ResolutionRequest } from "./resolve.js";
import type { AssemblyGraph, Issue, Part, PartGeometry, PartPiece } from "./types.js";

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

/** Angles are authored in decimal degrees, emitted as arc-minutes (I10). */
const ARCMIN_PER_DEG = 60;

const evalTriple = (
  exprs: readonly [ExprString, ExprString, ExprString],
  scope: Scope,
): [number, number, number] => [
  evalNumber(exprs[0], scope),
  evalNumber(exprs[1], scope),
  evalNumber(exprs[2], scope),
];

/**
 * Expand a part rule's geometry into physical pieces (step 5) and bake the
 * catalog facts the renderers need (cross-section profile, stock length) so
 * no renderer ever opens the catalog (I4). Geometry expressions are vendor
 * data — failures throw as authoring defects (ADR 0047), like any bad expr.
 */
function buildGeometry(
  rule: PartRule,
  scope: Scope,
  component: Component,
  catalog: Catalog,
): PartGeometry {
  const pieces: PartPiece[] = [];
  for (const geo of rule.geometry!) {
    const emit = (id: string, local: Scope): void => {
      const piece: PartPiece = {
        id,
        lengthMm: evalNumber(geo.length, local),
        at: evalTriple(geo.at, local),
        rotationArcMin:
          geo.rotation === undefined
            ? [0, 0, 0]
            : (evalTriple(geo.rotation, local).map((deg) => deg * ARCMIN_PER_DEG) as [
                number,
                number,
                number,
              ]),
      };
      if (geo.cuts !== undefined) {
        piece.cutArcMin = {
          ...(geo.cuts.left !== undefined && {
            left: evalNumber(geo.cuts.left, local) * ARCMIN_PER_DEG,
          }),
          ...(geo.cuts.right !== undefined && {
            right: evalNumber(geo.cuts.right, local) * ARCMIN_PER_DEG,
          }),
        };
      }
      pieces.push(piece);
    };

    if (geo.repeat === undefined) {
      emit(geo.key, scope);
      continue;
    }
    const count = evalNumber(geo.repeat.count, scope);
    if (!Number.isInteger(count) || count < 0) {
      throw new TypeError(
        `Geometry repeat count at "${rule.path}.${geo.key}" must be a non-negative ` +
          `integer, got ${count}`,
      );
    }
    for (let i = 0; i < count; i++) {
      emit(`${geo.key}[${i}]`, { ...scope, [geo.repeat.var]: i });
    }
  }

  const geometry: PartGeometry = { pieces };
  if (component.section !== undefined) {
    const section = catalog.sections.find((s) => s.code === component.section);
    if (section === undefined) {
      // Component names a section the catalog release doesn't carry —
      // catalog-internal data disagreement, author-shaped.
      throw new TypeError(
        `Component "${component.code}" names unknown section "${component.section}"`,
      );
    }
    geometry.profile = {
      shape: section.shape,
      ...(section.w_mm !== undefined && { wMm: section.w_mm }),
      ...(section.d_mm !== undefined && { dMm: section.d_mm }),
      ...(section.wall_mm !== undefined && { wallMm: section.wall_mm }),
    };
  }
  if (component.stockLength_mm !== undefined) geometry.stockLengthMm = component.stockLength_mm;
  return geometry;
}

/** Evaluate declared port anchors against the full post-derivation scope.
 *  Returns undefined when no port declares one (most BOM-era releases). */
export function evaluateAnchors(
  release: ProductModelRelease,
  scope: Scope,
): Record<string, [number, number, number]> | undefined {
  let anchors: Record<string, [number, number, number]> | undefined;
  for (const port of release.ports ?? []) {
    if (port.anchor === undefined) continue;
    anchors ??= {};
    anchors[port.id] = evalTriple(port.anchor.at, scope);
  }
  return anchors;
}

export function derive(
  release: ProductModelRelease,
  baseScope: Scope,
  catalog: Catalog,
  costScope?: Scope,
): DeriveOutcome {
  // Work on a copy so the caller's scope is not mutated (determinism hygiene).
  const scope: Scope = { ...baseScope };
  // The cost layer (ADR 0059): the same scope with `price.*` swapped for cost
  // numbers. Derived dimensions are physical — computed once against the real
  // scope and mirrored in, so only the recipe's value exprs see cost numbers.
  const costS: Scope | undefined = costScope ? { ...costScope } : undefined;
  const derived: Record<string, number> = {};

  for (const def of release.derivation.derived) {
    const value = evalNumber(def.expr, scope);
    scope[def.key] = value;
    derived[def.key] = value;
    if (costS) costS[def.key] = value;
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
      if (costS) part.costPerUnit = evalNumber(rule.bom.pricePerUnit, costS);
    }
    if (rule.bom.totalPrice !== undefined) {
      part.totalPrice = evalNumber(rule.bom.totalPrice, scope);
      if (costS) part.totalCost = evalNumber(rule.bom.totalPrice, costS);
    }
    if (rule.geometry !== undefined && rule.geometry.length > 0) {
      part.geometry = buildGeometry(rule, scope, component, catalog);
    }
    parts.push(part);
  }

  return { derived, parts, issues };
}
