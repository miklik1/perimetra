/**
 * The `where`↔fieldId bijection. `validateRelease` (and `slotScopes`) address
 * every defect by KEY/PATH — `parameters[<key>].defaultExpr`, `derived[<key>]`,
 * `constraints[<key>]` — never by array index, while React Hook Form tracks rows
 * by a numeric/opaque field id. These pure builders are the ONE place the editor
 * turns a field's business identity into the exact `where` string the gate emits,
 * so a defect is always read by the field that produced it (never dropped onto
 * the wrong row). An exhaustive test pins them against `slotScopes` over the
 * authored corpus.
 *
 * Phase 1 covers the flat-ish sections (identity, parameters, option sets,
 * constraints, derived). Phase 2 adds parts/geometry (below), keyed by part
 * `path` + geometry `key` — never by array index — exactly as `slotScopes` and
 * `validateRelease` emit them. Ports/ui wheres arrive with their later sections.
 */

// --- Parameters -------------------------------------------------------------
/** The parameter row itself (duplicate / dotted-key / default-ambiguous defects). */
export const whereParam = (key: string): string => `parameters[${key}]`;
/** The deviation block (the `deviation.unbounded` defect). */
export const whereParamDeviation = (key: string): string => `parameters[${key}].deviation`;
export const whereParamDefaultExpr = (key: string): string => `parameters[${key}].defaultExpr`;
export const whereParamRelevance = (key: string): string => `parameters[${key}].relevance`;
export const whereParamDeviationBound = (key: string, bound: "min" | "max"): string =>
  `parameters[${key}].deviation.${bound}`;

// --- Constraints ------------------------------------------------------------
export const whereConstraint = (key: string): string => `constraints[${key}]`;

// --- Derived ----------------------------------------------------------------
export const whereDerived = (key: string): string => `derived[${key}]`;

// --- Parts ------------------------------------------------------------------
/** The part row itself (the `path.duplicate` defect). */
export const wherePart = (path: string): string => `parts[${path}]`;
export const wherePartWhen = (path: string): string => `parts[${path}].when`;
/** The catalog role (the `catalog.role.unknown` defect — catalog-gated). */
export const wherePartResolveRole = (path: string): string => `parts[${path}].resolve.role`;
export const wherePartResolveSection = (path: string): string => `parts[${path}].resolve.section`;
export const wherePartResolveMaterial = (path: string): string => `parts[${path}].resolve.material`;
export type BomSlot = "quantity" | "lengthMm" | "pricePerUnit" | "totalPrice";
export const wherePartBom = (path: string, slot: BomSlot): string => `parts[${path}].bom.${slot}`;

// --- Geometry ---------------------------------------------------------------
/** The geometry piece itself (`key.duplicate` / `key.invalid` defects). */
export const whereGeometry = (path: string, key: string): string =>
  `parts[${path}].geometry[${key}]`;
export const whereGeometryRepeatCount = (path: string, key: string): string =>
  `parts[${path}].geometry[${key}].repeat.count`;
export const whereGeometryRepeatVar = (path: string, key: string): string =>
  `parts[${path}].geometry[${key}].repeat.var`;
export const whereGeometryLength = (path: string, key: string): string =>
  `parts[${path}].geometry[${key}].length`;
export type Axis = 0 | 1 | 2;
export const whereGeometryAt = (path: string, key: string, axis: Axis): string =>
  `parts[${path}].geometry[${key}].at[${axis}]`;
export const whereGeometryRotation = (path: string, key: string, axis: Axis): string =>
  `parts[${path}].geometry[${key}].rotation[${axis}]`;
export const whereGeometryCut = (path: string, key: string, side: "left" | "right"): string =>
  `parts[${path}].geometry[${key}].cuts.${side}`;
