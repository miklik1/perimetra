/**
 * The drawing-rule DSL (CORE_SPEC §5, spike 2026-07-08 — ADR pending). A per-
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

/** The family's drawing spec: views + the rules that annotate them. */
export interface DrawingSpec {
  views: ViewDef[];
  rules: DrawingRule[];
}
