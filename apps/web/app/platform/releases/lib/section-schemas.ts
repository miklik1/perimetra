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

// --- Parts / geometry (Phase 2) ---------------------------------------------
export const bomUnitValues = ["meter", "piece", "set", "hour"] as const;
export const bomCategoryValues = [
  "material",
  "accessory",
  "manufacturing",
  "installation",
] as const;

/** One physical piece for the renderers (step 5). Expr slots are strings; the
 *  optional blocks (rotation / cuts / repeat) ride a boolean toggle, "" = omit. */
const geometryDraftSchema = z.object({
  key: z.string(),
  length: z.string(),
  atX: z.string(),
  atY: z.string(),
  atZ: z.string(),
  useRotation: z.boolean(),
  rotX: z.string(),
  rotY: z.string(),
  rotZ: z.string(),
  cutLeft: z.string(),
  cutRight: z.string(),
  useRepeat: z.boolean(),
  repeatCount: z.string(),
  repeatVar: z.string(),
});

/** A catalog-resolved part rule + its BOM + geometry. `role` is a plain catalog
 *  role; `section`/`material`/`when` and every `bom*` slot are Expr strings
 *  ("" = omit, except the required `bomQuantity`). */
const partDraftSchema = z.object({
  path: z.string(),
  name: z.string(),
  role: z.string(),
  section: z.string(),
  material: z.string(),
  when: z.string(),
  bomUnit: z.enum(bomUnitValues),
  bomQuantity: z.string(),
  bomLengthMm: z.string(),
  bomPricePerUnit: z.string(),
  bomTotalPrice: z.string(),
  bomCategory: z.enum(bomCategoryValues),
  geometry: z.array(geometryDraftSchema),
});

export const releaseDraftSchema = z.object({
  modelId: z.string(),
  version: z.coerce.number().int().nonnegative(),
  catalogVersion: z.coerce.number().int().nonnegative(),
  parameters: z.array(paramDraftSchema),
  constraints: z.array(constraintDraftSchema),
  derived: z.array(derivedDraftSchema),
  parts: z.array(partDraftSchema),
  // Raw-JSON islands for sections not yet structured (Phase 4 replaces these);
  // "" means absent. They are still validated live by validateRelease.
  optionSetsJson: z.string(),
  portsJson: z.string(),
  terrainJson: z.string(),
  uiJson: z.string(),
  // Golden fixtures (I2) ride a raw-JSON island too — REQUIRED-non-empty at the
  // publish gate, so this is the in-editor way to clear the `fixtures.empty` defect.
  fixturesJson: z.string(),
});

/** Form input shape (what the DOM holds — version/catalogVersion are strings). */
export type ReleaseDraftInput = z.input<typeof releaseDraftSchema>;
/** Built shape after coercion. */
export type ReleaseDraft = z.output<typeof releaseDraftSchema>;
export type ParamDraft = z.input<typeof paramDraftSchema>;
export type ConstraintDraft = z.input<typeof constraintDraftSchema>;
export type DerivedDraft = z.input<typeof derivedDraftSchema>;
export type PartDraft = z.input<typeof partDraftSchema>;
export type GeometryDraft = z.input<typeof geometryDraftSchema>;

/** The editor's RHF form handle — matches `useZodForm(releaseDraftSchema)`'s
 *  input/output generics so it threads cleanly through the workbenches. */
export type ReleaseEditorForm = UseFormReturn<ReleaseDraftInput, unknown, ReleaseDraft>;
