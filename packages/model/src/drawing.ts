/**
 * The drawing-rule DSL (CORE_SPEC §5, spike 2026-07-08 — ADR 0102). A per-
 * family, declarative spec — carried as IMMUTABLE release data (a sibling of
 * `ui?: UiSpec`), so it freezes into the quote snapshot and a re-derived
 * historical quote reproduces byte-identical drawings (I3). Authored ONCE per
 * family and amortised across every configured instance: a rule binds a dimension
 * or label to a NAMED model feature (an I9 piece id) and takes its printed VALUE
 * from a derived-scope key — so the number the drawing prints IS the number the
 * engine derived (and the BOM/golden use). Zero drift, zero hand-layout.
 *
 * Kept deliberately MINIMAL (three rule kinds, one selector grammar): the failure
 * mode of every drawing DSL is ballooning into a mini-CAD language, which defeats
 * the amortisation. The value is a derived KEY (not yet a full Expr) — enough to
 * prove the emitter; a value-Expr form is the natural extension behind `drawScopes`.
 */

/** Which projected extent a rule brackets. */
export type MeasureAxis = "x-extent" | "y-extent";
/** Where the dimension line sits relative to the view. */
export type DimensionSide = "top" | "bottom" | "left" | "right";

/** Selects the geometry a rule dimensions/labels: a piece id or glob
 *  (`<partPath>/<pieceKey>`, `*` wildcard — e.g. `fill.material/piece[*]`)
 *  matched against the projected linework's I9 source ids. */
export interface FeatureSelector {
  pieces: string;
}

/** The ONE definition of the feature-glob grammar (the model owns the DSL): `*`
 *  is a wildcard, every other char (incl. the `.`/`[`/`]` piece ids carry) is a
 *  literal. Consumed by BOTH the runtime Annotator and the publish-gate
 *  `drawScopes` check, so a rule that passes validation is a rule that matches at
 *  runtime — no drift between the two. */
export function pieceGlobToRegex(glob: string): RegExp {
  const esc = glob.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${esc}$`);
}

/** A single linear dimension bracketing a feature's projected extent. */
export interface DimensionRule {
  kind: "dimension";
  id: string;
  feature: FeatureSelector;
  measure: MeasureAxis;
  side: DimensionSide;
  /** Derived-scope key whose value is PRINTED (guarantees Excel fidelity). Absent
   *  = the measured projected extent. */
  derivedValue?: string;
}

/** A chained/ladder dimension over a repeated piece set (the fill slats): one
 *  bracketed run per consecutive gap, printed with the shared pitch value. */
export interface ChainRule {
  kind: "chain";
  id: string;
  feature: FeatureSelector;
  /** The axis the pieces step along (`y-extent` for vertically stacked slats). */
  measure: MeasureAxis;
  side: DimensionSide;
  /** Derived-scope key of the pitch (printed on the ladder). */
  derivedValue?: string;
}

/** A member-letter / note callout at a feature's centroid (Excel A–I). */
export interface LabelRule {
  kind: "label";
  id: string;
  feature: FeatureSelector;
  text: string;
}

export type DrawingRule = DimensionRule | ChainRule | LabelRule;

/** One derived view (projection + a future section plane). */
export interface ViewDef {
  id: string;
  projection: "front" | "top" | "side";
}

/** The world axis a section plane's normal runs along (the typed, axis-aligned
 *  reduction of the ADR-0092 `PlaneSpec` — every real gate cut is orthogonal).
 *  `x` = a cross-slice through the leaf (frame profiles seen edge-on), `y` = a
 *  plan cut, `z` = a front-parallel slice. */
export type SectionAxis = "x" | "y" | "z";

/** A section cut, authored as DATA (a sibling of a `ViewDef`). The plane is
 *  `axis · p = offsetMm`; the Sectioner emits the outer outline of every piece
 *  the plane cuts transversely, hatched. HONESTY (I5): a profile the catalog
 *  gives no real depth (flat plank, h-channel) sections to a DEGRADED outline
 *  flagged `nominalDepth` — the emitter never invents a wall it wasn't given. */
export interface SectionDef {
  id: string;
  axis: SectionAxis;
  /** Signed plane offset from the origin along `axis`, mm. */
  offsetMm: number;
}

/** The family's drawing spec: views + the rules that annotate them + optional
 *  section cuts (emitted as hatched cross-sections beside the elevation). */
export interface DrawingSpec {
  views: ViewDef[];
  rules: DrawingRule[];
  sections?: SectionDef[];
}
