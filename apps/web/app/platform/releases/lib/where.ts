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
 * constraints, derived). Builders are added as their consuming workbench lands
 * (the parameter-row / option-set structural-defect wheres arrive with their
 * sections in the editor surface); parts/geometry/ports wheres arrive Phase 2.
 */

// --- Parameters -------------------------------------------------------------
export const whereParamDefaultExpr = (key: string): string => `parameters[${key}].defaultExpr`;
export const whereParamRelevance = (key: string): string => `parameters[${key}].relevance`;
export const whereParamDeviationBound = (key: string, bound: "min" | "max"): string =>
  `parameters[${key}].deviation.${bound}`;

// --- Constraints ------------------------------------------------------------
export const whereConstraint = (key: string): string => `constraints[${key}]`;

// --- Derived ----------------------------------------------------------------
export const whereDerived = (key: string): string => `derived[${key}]`;
