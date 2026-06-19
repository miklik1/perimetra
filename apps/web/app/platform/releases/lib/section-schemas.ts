/**
 * The editor's form schema — STRUCTURAL only. It shapes the React Hook Form
 * state (so `useZodForm` + `useFieldArray` are typed); the deep semantics (Expr
 * parsing, key uniqueness, reference scope, I2 defects) stay in
 * `validateRelease`, which runs live over the BUILT release — never duplicated
 * here. Expression fields are plain strings; enums come from selects.
 */
import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";

export const paramTypeValues = [
  "length_mm",
  "int",
  "select",
  "multiselect",
  "bool",
  "color",
  "text",
] as const;
export const adjustabilityValues = ["vendor", "tenant", "user"] as const;
export const constraintKindValues = ["range", "requires", "excludes", "expr"] as const;
export const severityValues = ["error", "warn"] as const;
export const constraintScopeValues = ["instance", "connection"] as const;
/** Editor-only field enums (carry a "none" the model omits). */
export const valueModeValues = ["none", "literal", "expr"] as const;
export const domainKindValues = ["none", "range", "enum", "pattern"] as const;
export const deviationFieldModeValues = ["none", "free", "warn", "hard"] as const;

const paramDraftSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(paramTypeValues),
  adjustability: z.enum(adjustabilityValues),
  /** How the default is supplied: none | a typed literal | an expression. */
  valueMode: z.enum(valueModeValues),
  defaultLiteral: z.string(),
  defaultExpr: z.string(),
  relevance: z.string(),
  domainKind: z.enum(domainKindValues),
  domainMin: z.string(),
  domainMax: z.string(),
  domainStep: z.string(),
  /** Comma-separated for an enum domain. */
  domainValues: z.string(),
  domainPattern: z.string(),
  deviationMode: z.enum(deviationFieldModeValues),
  deviationMin: z.string(),
  deviationMax: z.string(),
  deviationNote: z.string(),
});

const constraintDraftSchema = z.object({
  key: z.string(),
  kind: z.enum(constraintKindValues),
  expr: z.string(),
  severity: z.enum(severityValues),
  scope: z.enum(constraintScopeValues),
});

const derivedDraftSchema = z.object({
  key: z.string(),
  expr: z.string(),
});

export const releaseDraftSchema = z.object({
  modelId: z.string(),
  version: z.coerce.number().int().nonnegative(),
  catalogVersion: z.coerce.number().int().nonnegative(),
  parameters: z.array(paramDraftSchema),
  constraints: z.array(constraintDraftSchema),
  derived: z.array(derivedDraftSchema),
  // Raw-JSON islands for sections not yet structured (Phase 2/4 replace these);
  // "" means absent. They are still validated live by validateRelease.
  optionSetsJson: z.string(),
  partsJson: z.string(),
  portsJson: z.string(),
  terrainJson: z.string(),
  uiJson: z.string(),
});

/** Form input shape (what the DOM holds — version/catalogVersion are strings). */
export type ReleaseDraftInput = z.input<typeof releaseDraftSchema>;
/** Built shape after coercion. */
export type ReleaseDraft = z.output<typeof releaseDraftSchema>;
export type ParamDraft = z.input<typeof paramDraftSchema>;
export type ConstraintDraft = z.input<typeof constraintDraftSchema>;
export type DerivedDraft = z.input<typeof derivedDraftSchema>;

/** The editor's RHF form handle — matches `useZodForm(releaseDraftSchema)`'s
 *  input/output generics so it threads cleanly through the workbenches. */
export type ReleaseEditorForm = UseFormReturn<ReleaseDraftInput, unknown, ReleaseDraft>;
