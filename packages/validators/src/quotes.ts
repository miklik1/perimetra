/**
 * Quote contracts (CORE_SPEC §6) — the quote lifecycle's api↔frontend seam.
 * The issue input carries the site graph + the per-instance roster (release pin
 * + raw config + overrides); the engine is the validation gate (invalid config
 * → typed issues, I5), so site/overrides cross as opaque payloads here.
 *
 * `stamps` is the engine `SiteStamps` (full I3 addressing); `snapshot` is the
 * frozen engine/renderer output — opaque to zod (the engine's own valid output).
 * It ALSO carries the frozen buyer identity (ADR 0086): authorized-issuer data,
 * stripped server-side for the price-blind workshop, so passthrough is sound.
 */
import { z } from "zod";

import { cursorQuerySchema, paginated } from "./api/pagination";
// Reuse the price-table rounding policy (ADR 0081) — one source of the shape.
import { roundingPolicySchema } from "./price-tables";
import { isoDatetime } from "./primitives";

export const QUOTE_STATUSES = ["draft", "issued", "accepted", "declined", "expired"] as const;
export const quoteStatusSchema = z.enum(QUOTE_STATUSES);
export type QuoteStatus = z.infer<typeof quoteStatusSchema>;

/** One configured instance in an issue request. */
export const quoteInstanceInputSchema = z.object({
  instanceId: z.string().min(1),
  /** "modelId@version" — resolved against the immutable release store. */
  releaseId: z.string().min(1),
  /** ConfigInput (raw per-instance values). */
  input: z.record(z.string(), z.unknown()),
  /** CascadeLayers (tenant/customer/quote overrides) — opaque to the wire. */
  overrides: z.unknown().optional(),
});
export type QuoteInstanceInput = z.infer<typeof quoteInstanceInputSchema>;

export const issueQuoteSchema = z.object({
  /** Nullable until project persistence lands. */
  projectId: z.uuid().optional(),
  /** The attached buyer (odběratel, ADR 0082). When present, the §92e VAT-status
   *  is auto-filled from the customer (the request `tax.customerVatPayer` is
   *  ignored in favour of the customer's own flag). */
  customerId: z.uuid().optional(),
  /** The Site graph (terrain/placements/connections) — engine-validated. */
  site: z.unknown(),
  instances: z.array(quoteInstanceInputSchema).min(1),
  validUntil: isoDatetime.optional(),
  /** Cut-list blade kerf, mm — stamped into the snapshot (reproducibility). */
  kerfMm: z.number().int().nonnegative().optional(),
  /**
   * Admin-only escape hatch for the margin-floor guard (ADR 0056): when the
   * derived margin is below the org floor, an `admin` may issue anyway by
   * supplying a justification (audited as `quote.margin_override`). Ignored for
   * non-admin roles — sales gets a 422 they cannot override.
   */
  marginOverride: z.object({ reason: z.string().min(1) }).optional(),
  /**
   * Tax facts for the §92e/DPH decision (ADR 0080). §92e reverse charge is a
   * per-TRANSACTION call: it applies only when the buyer is a CZ VAT payer AND
   * the supply is construction/assembly. Absent → standard VAT. The buyer's VAT
   * status is auto-filled from the attached customer once that entity lands
   * (ADR 0082); supplied explicitly here until then.
   */
  tax: z
    .object({
      customerVatPayer: z.boolean().optional(),
      constructionAssembly: z.boolean().optional(),
    })
    .optional(),
});
export type IssueQuoteInput = z.infer<typeof issueQuoteSchema>;

/** Engine `SiteStamps` — the exact versioned inputs a quote re-derives from (I3).
 *  `catalogVersions` is releaseId → catalog version (per-release catalog,
 *  ADR 0065): each release re-derives against its OWN pinned catalog. */
export const quoteStampsSchema = z.object({
  releaseIds: z.record(z.string(), z.string()),
  catalogVersions: z.record(z.string(), z.number().int()),
  priceTableVersion: z.number().int(),
  overrideIds: z.array(z.string()),
});
export type QuoteStamps = z.infer<typeof quoteStampsSchema>;

export const quoteSummarySchema = z.object({
  id: z.uuid(),
  projectId: z.uuid().nullable(),
  customerId: z.uuid().nullable(),
  status: quoteStatusSchema,
  /** Gap-free, org-scoped, per-year evidence number (ADR 0079), `{year}/{seq:04d}`. */
  documentNumber: z.string(),
  currency: z.string(),
  /**
   * Decimal-string total (I10), or `null` for the PRICE-BLIND `workshop` view
   * (ADR 0056) — the server strips it, the field is never just FE-hidden.
   */
  total: z.string().nullable(),
  validUntil: isoDatetime.nullable(),
  shareToken: z.string(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});
export type QuoteSummary = z.infer<typeof quoteSummarySchema>;

export const quoteSchema = quoteSummarySchema.extend({
  stamps: quoteStampsSchema,
  /** Frozen outputs: bom / totals / money / cutList / drawings / inputs / site /
   *  tax + the frozen buyer identity (ADR 0086). Opaque passthrough. */
  snapshot: z.unknown(),
});
export type QuoteDetail = z.infer<typeof quoteSchema>;

export const listQuotesQuerySchema = cursorQuerySchema.extend({
  status: quoteStatusSchema.optional(),
});
export type ListQuotesQuery = z.infer<typeof listQuotesQuerySchema>;

export const quotesPageSchema = paginated(quoteSummarySchema);
export type QuotesPage = z.infer<typeof quotesPageSchema>;

/** Buyer-facing acknowledgement of an accept/decline via shareToken (ADR 0083) —
 *  deliberately minimal (the document number + the new status), never the priced
 *  snapshot. */
export const quoteAcceptanceSchema = z.object({
  documentNumber: z.string(),
  status: quoteStatusSchema,
});
export type QuoteAcceptance = z.infer<typeof quoteAcceptanceSchema>;

// --- Buyer-facing public nabídka (ADR 0089) ----------------------------------
//
// The shapes below mirror the pure-data `NabidkaDocument` (the L layer, ADR 0085,
// in `@repo/renderers`) so the buyer-facing `GET /v1/quotes/shared/:token` can
// return a TYPED, zod-stripped document. The boundary is load-bearing security:
// the endpoint is UNAUTHENTICATED (the unguessable shareToken IS the credential),
// so the server builds the document from the frozen snapshot and returns ONLY
// these fields — the snapshot's cost/margin (ADR 0059), re-derivation seeds, and
// I3 stamps NEVER cross. The schema's strip semantics are the belt to that
// allowlist-by-construction suspenders.

/** One per-rate line of the §92e/DPH breakdown (ADR 0080). */
export const taxRateLineSchema = z.object({
  ratePct: z.string(),
  netBase: z.string(),
  vatAmount: z.string(),
  gross: z.string(),
});

/** The structured, frozen §92e/DPH tax document (ADR 0080) — mirrors
 *  `TaxBreakdown` from `@repo/model`. */
export const taxBreakdownSchema = z.object({
  mode: z.enum(["standard_vat", "reverse_charge_92e"]),
  legend: z.string().optional(),
  currency: z.string(),
  rounding: roundingPolicySchema,
  lines: z.array(taxRateLineSchema),
  netTotal: z.string(),
  vatTotal: z.string(),
  grossTotal: z.string(),
});

/** Supplier (dodavatel) block — the §29-ZDPH identity (ADR 0088). */
export const nabidkaSupplierSchema = z.object({
  name: z.string(),
  ico: z.string().nullish(),
  dic: z.string().nullish(),
  addressLine: z.string().nullish(),
  city: z.string().nullish(),
  postalCode: z.string().nullish(),
  bankAccount: z.string().nullish(),
  registrationNote: z.string().nullish(),
});

/** Buyer (odběratel) block — the document-identity subset (ADR 0086). No
 *  bankAccount, no contact fields. */
export const nabidkaCustomerSchema = z.object({
  name: z.string(),
  ico: z.string().nullish(),
  dic: z.string().nullish(),
  addressLine: z.string().nullish(),
  city: z.string().nullish(),
  postalCode: z.string().nullish(),
});

/** One priced offer line (a rolled-up BOM line) — the SELLING price only; the
 *  cost is never part of this shape. */
export const nabidkaLineSchema = z.object({
  componentCode: z.string(),
  name: z.string(),
  unit: z.string(),
  category: z.string(),
  quantity: z.number(),
  totalPriceMoney: z.string(),
});

/** A net subtotal per BOM category. */
export const nabidkaCategorySchema = z.object({
  key: z.enum(["material", "accessory", "manufacturing", "installation"]),
  total: z.string(),
});

/** The pure-data nabídka the buyer renders — mirrors `NabidkaDocument`
 *  (`@repo/renderers`). Carries prices (the buyer's own quote) but NO cost. */
export const nabidkaDocumentSchema = z.object({
  documentNumber: z.string(),
  supplier: nabidkaSupplierSchema.nullable(),
  customer: nabidkaCustomerSchema.nullable(),
  currency: z.string(),
  instanceCount: z.number(),
  lines: z.array(nabidkaLineSchema),
  categories: z.array(nabidkaCategorySchema),
  tax: taxBreakdownSchema,
  netTotal: z.string(),
  vatTotal: z.string(),
  grossTotal: z.string(),
  legend: z.string().optional(),
});
export type NabidkaDocumentDto = z.infer<typeof nabidkaDocumentSchema>;

/** The buyer-facing envelope returned by `GET /v1/quotes/shared/:token` (ADR
 *  0089): the built document + the effective status (so the buyer view gates
 *  accept/decline and shows an accepted/declined/expired banner) + validUntil.
 *  The document holds no cost, no stamps, no re-derivation seeds. */
export const sharedNabidkaSchema = z.object({
  document: nabidkaDocumentSchema,
  status: quoteStatusSchema,
  validUntil: isoDatetime.nullable(),
});
export type SharedNabidka = z.infer<typeof sharedNabidkaSchema>;

/** Result of the I3 reproducibility check (the verification path). */
export const quoteReproductionSchema = z.object({
  quoteId: z.uuid(),
  reproduced: z.boolean(),
  /** Artifacts (or missing stamps) that diverged — empty when reproduced. */
  mismatches: z.array(z.string()),
});
export type QuoteReproduction = z.infer<typeof quoteReproductionSchema>;

// --- Workshop PRODUCTION view (CAR-24) ---------------------------------------
//
// The fabricator's build surface: cut list + BOM quantities + 2D drawings, off
// the quote's FROZEN snapshot (never re-derived — I3: a since-changed price
// table/release must not alter what gets built). This is a ROLE-INDEPENDENT
// view — production has no price to hide from admin/sales either, it's a
// distinct SURFACE (what to build), not a distinct permission level — so it is
// ALWAYS this shape, never role-conditional like `quoteSchema`'s snapshot.
//
// Every field below is hand-mirrored off `@repo/renderers` (`CutList`,
// `WorkshopDrawing`, `SitePlan`) and `@repo/engine` (`SiteBomLine`) the same
// way `taxBreakdownSchema`/`nabidkaDocumentSchema` mirror their sources above —
// `@repo/validators` cannot depend on `renderers`/`engine`/`model` (the
// boundaries DAG keeps it a zero-dep leaf), so the shapes are copied, not
// imported. A STRUCTURED, typed response (not `z.unknown()` passthrough) is the
// point: the strip semantics live in the schema itself (ADR 0039), not just in
// the server-side projection that builds it.

const productionPointSchema = z.object({ x: z.number(), y: z.number() });
const productionQuadSchema = z.tuple([
  productionPointSchema,
  productionPointSchema,
  productionPointSchema,
  productionPointSchema,
]);

/** Mirrors `SiteBomLine`, allowlisted to the NON-money fields (drops
 *  `totalPrice`/`totalPriceMoney` — production quantities, never price). */
export const productionBomLineSchema = z.object({
  componentCode: z.string(),
  name: z.string(),
  unit: z.string(),
  category: z.string(),
  quantity: z.number(),
  /** Every surviving part folded into this line (I9 site addresses). */
  sources: z.array(z.object({ instanceId: z.string(), path: z.string() })),
});

/** Mirrors `PieceProfile` (@repo/engine). */
const productionPieceProfileSchema = z.object({
  shape: z.enum(["L", "U", "T", "rect_tube", "flat", "pane", "custom"]),
  wMm: z.number().optional(),
  dMm: z.number().optional(),
  wallMm: z.number().optional(),
});

/** Mirrors `CutLine` (@repo/renderers `cutlist.ts`). */
const productionCutLineSchema = z.object({
  componentCode: z.string(),
  name: z.string(),
  lengthMm: z.number(),
  cutArcMin: z.object({ left: z.number().optional(), right: z.number().optional() }).optional(),
  count: z.number(),
  sources: z.array(z.string()),
});

/** Mirrors `StockBar` (@repo/renderers `cutlist.ts`). */
const productionStockBarSchema = z.object({
  index: z.number(),
  stockLengthMm: z.number(),
  cuts: z.array(z.object({ lengthMm: z.number(), source: z.string() })),
  usedMm: z.number(),
  offcutMm: z.number(),
});

/** Mirrors `ComponentCuts` (@repo/renderers `cutlist.ts`). */
const productionComponentCutsSchema = z.object({
  componentCode: z.string(),
  name: z.string(),
  profile: productionPieceProfileSchema.optional(),
  lines: z.array(productionCutLineSchema),
  totalPieces: z.number(),
  totalLengthMm: z.number(),
  nesting: z
    .object({
      stockLengthMm: z.number(),
      kerfMm: z.number(),
      bars: z.array(productionStockBarSchema),
      oversize: z.array(z.object({ lengthMm: z.number(), source: z.string() })),
    })
    .optional(),
});

/** Mirrors `CutList` (@repo/renderers `cutlist.ts`). */
export const productionCutListSchema = z.object({
  components: z.array(productionComponentCutsSchema),
});

/**
 * Mirrors `DrawingFlag` (@repo/renderers `drawing2d.ts`) — NARROWED to the two
 * PHYSICAL `ArtifactField`s (@repo/model): a part deviation can also target the
 * commercial `pricePerUnit`/`totalPrice` fields (a cascade-override reaching an
 * artifact price), and that raw float must never cross this boundary. The
 * server-side projection drops those flags before this ever parses; the `enum`
 * here is the schema-level backstop — a smuggled commercial flag fails closed
 * (a validation error), never silently serializes.
 */
const productionDrawingFlagSchema = z.object({
  partPath: z.string(),
  field: z.enum(["quantity", "lengthMm"]),
  original: z.number().optional(),
  value: z.number(),
  overrideId: z.string(),
  reason: z.string().optional(),
});

/** Mirrors `WorkshopDrawing` (@repo/renderers `drawing2d.ts`). */
export const productionWorkshopDrawingSchema = z.object({
  quads: z.array(
    z.object({
      id: z.string(),
      componentCode: z.string(),
      points: productionQuadSchema,
      deviated: z.boolean().optional(),
    }),
  ),
  dims: z.array(
    z.object({
      id: z.string(),
      from: productionPointSchema,
      to: productionPointSchema,
      valueMm: z.number(),
    }),
  ),
  flags: z.array(productionDrawingFlagSchema),
  bbox: z.object({ min: productionPointSchema, max: productionPointSchema }),
});

/** Mirrors `SitePlan` (@repo/renderers `drawing2d.ts`). */
export const productionSitePlanSchema = z.object({
  instances: z.array(
    z.object({
      instanceId: z.string(),
      outline: productionQuadSchema,
      labelAt: productionPointSchema,
    }),
  ),
  connections: z.array(
    z.object({
      connection: z.number(),
      from: productionPointSchema,
      to: productionPointSchema,
      shared: z.object({ ownerInstanceId: z.string(), partPath: z.string() }).optional(),
    }),
  ),
  terrain: z.array(
    z.object({
      id: z.string(),
      elevationMm: z.number(),
      instanceIds: z.array(z.string()),
    }),
  ),
});

/** One roster instance's product identity (release natural key) — enough to
 *  label a drawing/cut group (e.g. "gate — sliding-gate@1"); NOT the raw
 *  `ConfigInput` (that's a free-form record the release schema controls, and
 *  production has no need to re-derive, so it never crosses this boundary). */
export const productionInstanceSchema = z.object({
  instanceId: z.string(),
  releaseId: z.string(),
});

/** Only an effectively `issued`/`accepted` quote has a production run — a
 *  declined/expired offer, or an (unreachable today) draft, has nothing to
 *  build. */
export const producibleQuoteStatusSchema = z.enum(["issued", "accepted"]);

// --- Frozen technical drawing + spec/dimension rows (ADR 0102/0108) ----------
//
// The derived 2D technical drawing (ADR 0102) and the §8 spec sheet, frozen into
// the quote snapshot and projected onto this price-blind surface. Hand-mirrored
// off `@repo/renderers` (`TechnicalDrawing`/`PlacedAnnotation`/`DrawnEdge2D`/
// `SectionView`) the same zero-dep-leaf way the rest of this file mirrors its
// sources. STRUCTURED, never `z.unknown()`: the strip semantics that keep this
// surface price-blind live in the schema shape itself — the drawing is geometry,
// so NO money/cost/margin field appears anywhere below.

/** Mirrors `DrawnEdge2D` (@repo/renderers `drawing/types.ts`) — one projected
 *  view edge, tagged with its I9 source id + per-view line role. */
const productionDrawnEdgeSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  role: z.enum(["visible", "hidden", "section", "center"]),
  from: productionPointSchema,
  to: productionPointSchema,
});

/** Mirrors `PlacedAnnotation` (@repo/renderers `drawing/dimsolve.ts`) — a placed
 *  dimension/chain/label. `label` is the release-authored Czech display text
 *  (absent ⇒ the rule id is shown); `valueMm` the measured/printed value. */
const productionAnnotationSchema = z.object({
  id: z.string(),
  kind: z.enum(["dimension", "chain", "label"]),
  valueMm: z.number().optional(),
  text: z.string().optional(),
  label: z.string().optional(),
  line: z.object({ from: productionPointSchema, to: productionPointSchema }),
  witness: z.array(z.object({ from: productionPointSchema, to: productionPointSchema })),
  ticks: z.array(productionPointSchema).optional(),
  textAt: productionPointSchema,
});

/** Mirrors `SectionCut` (@repo/renderers `drawing/section.ts`). */
const productionSectionCutSchema = z.object({
  sourceId: z.string(),
  componentCode: z.string(),
  outline: z.array(productionPointSchema),
  nominalDepth: z.boolean(),
});

/** Mirrors `SectionView` (@repo/renderers `drawing/section.ts`). */
const productionSectionViewSchema = z.object({
  sectionId: z.string(),
  axis: z.enum(["x", "y", "z"]),
  offsetMm: z.number(),
  cuts: z.array(productionSectionCutSchema),
  bbox: z.object({ min: productionPointSchema, max: productionPointSchema }),
  dataFillNeeded: z.boolean(),
});

/** Mirrors `TechnicalDrawing` (@repo/renderers `drawing/drawing.ts`) — the
 *  derived 2D elevation (ADR 0102): projected edges + placed dimensions/labels +
 *  optional hatched sections. Geometry only, no money. */
export const productionTechnicalDrawingSchema = z.object({
  viewId: z.string(),
  edges: z.array(productionDrawnEdgeSchema),
  annotations: z.array(productionAnnotationSchema),
  bbox: z.object({ min: productionPointSchema, max: productionPointSchema }),
  sections: z.array(productionSectionViewSchema).optional(),
});
export type ProductionTechnicalDrawing = z.infer<typeof productionTechnicalDrawingSchema>;

/** One frozen §8 spec-sheet row (ADR 0108) — a release-authored label + the
 *  display value off the frozen ConfigInput. `value` is a display string (option
 *  label / raw value + unit), never money. */
export const productionSpecRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
});
export type ProductionSpecRow = z.infer<typeof productionSpecRowSchema>;

/** One dimension row derived from a technical drawing's annotations (ADR 0108):
 *  the annotation label (or rule id) + its measured value (mm). */
export const productionDimensionRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  valueMm: z.number(),
});
export type ProductionDimensionRow = z.infer<typeof productionDimensionRowSchema>;

export const quoteProductionSchema = z.object({
  id: z.uuid(),
  documentNumber: z.string(),
  status: producibleQuoteStatusSchema,
  createdAt: isoDatetime,
  instances: z.array(productionInstanceSchema),
  bom: z.array(productionBomLineSchema),
  cutList: productionCutListSchema,
  cutOptions: z.object({ kerfMm: z.number().int().nonnegative() }),
  drawings: z.object({
    site: productionSitePlanSchema,
    instances: z.record(z.string(), productionWorkshopDrawingSchema),
  }),
  /** The derived 2D technical drawings per instance (ADR 0102/0108). Optional: a
   *  quote issued before the frozen-drawing slice has none, and the projection
   *  omits it rather than fabricating one (N-1). */
  technicalDrawings: z.record(z.string(), productionTechnicalDrawingSchema).optional(),
  /** Frozen §8 spec-sheet rows per instance (ADR 0108). Optional (pre-slice). */
  specRows: z.record(z.string(), z.array(productionSpecRowSchema)).optional(),
  /** Dimension rows per instance, off the technical drawing's annotations
   *  (ADR 0108). Optional (pre-slice). */
  dimensionRows: z.record(z.string(), z.array(productionDimensionRowSchema)).optional(),
});
export type QuoteProduction = z.infer<typeof quoteProductionSchema>;
