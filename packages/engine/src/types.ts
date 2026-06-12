/**
 * The engine's output types — the assembly graph and the derivation result
 * (CORE_SPEC §5). In slice 1 a single instance is the degenerate site (I11):
 * the assembly graph IS the whole result. Everything downstream (BOM, price,
 * and later cut list / 3D / 2D) derives from these parts — no consumer
 * recomputes geometry from raw config (I4).
 */
import type {
  ArtifactField,
  BomCategory,
  BomUnit,
  MoneyString,
  SectionShape,
  Value,
} from "@repo/model";

/** The workshop-drawing flag (CORE_SPEC §6): an artifact override applied to a
 *  part. Mandatory and visible — the workshop always sees what deviated. */
export interface PartDeviation {
  field: ArtifactField;
  /** The derived value before the patch (absent when the field was unset). */
  original?: number;
  value: number;
  overrideId: string;
  reason?: string;
}

/** Cross-section of a part's pieces, baked from the resolved component's
 *  catalog section at derivation time — renderers never open the catalog or
 *  recompute anything (I4). */
export interface PieceProfile {
  shape: SectionShape;
  wMm?: number;
  dMm?: number;
  wallMm?: number;
}

/** One physical piece (a {@link import("@repo/model").GeometryRule} instance):
 *  what the scene places, the drawing projects, and the cut list cuts. */
export interface PartPiece {
  /** Part-relative id: `<key>` or `<key>[i]` (I9). Site address:
   *  `<instanceId>/<partPath>/<id>`. */
  id: string;
  /** Length along the piece's local X axis before rotation, mm. */
  lengthMm: number;
  /** Assembly-space origin [x, y, z], mm. */
  at: [number, number, number];
  /** Rotation about [X, Y, Z], arc-minutes (I10; authored as degrees). */
  rotationArcMin: [number, number, number];
  /** Mitre angles, arc-minutes from the piece axis; absent end = square 90°. */
  cutArcMin?: { left?: number; right?: number };
}

/** A part's physical reality for the renderers — pieces plus everything the
 *  cut list needs (profile, stock length), resolved once by the engine. */
export interface PartGeometry {
  profile?: PieceProfile;
  /** Stock bar length for cut-list nesting (catalog `stockLength_mm`). */
  stockLengthMm?: number;
  pieces: PartPiece[];
}

/** One physical part produced by a {@link import("@repo/model").PartRule}. */
export interface Part {
  /** Stable id (I9) — survives re-derivation. */
  path: string;
  componentCode: string;
  name: string;
  unit: BomUnit;
  quantity: number;
  lengthMm?: number;
  category: BomCategory;
  /** Resolved unit price (from the price layer) — absent until priced. */
  pricePerUnit?: number;
  /** quantity × pricePerUnit, or an explicit override. */
  totalPrice?: number;
  /** Applied artifact overrides — rendered as deviation flags (CORE_SPEC §6). */
  deviations?: PartDeviation[];
  /** Physical pieces (step 5) — absent on BOM-only parts (labor, kits). */
  geometry?: PartGeometry;
}

/** The derived assembly: named dimensions + the parts list. */
export interface AssemblyGraph {
  derived: Record<string, number>;
  parts: Part[];
}

/**
 * A surfaced config-time problem (CORE_SPEC §3 constraints, plus the input
 * gate and catalog resolution). `key` is the i18n message key; `params` is the
 * interpolation payload. The taxonomy split: AUTHOR-time errors (bad release /
 * catalog data) throw, CONFIG-time errors (user-shaped input) become Issues —
 * never raw throws on user input.
 */
export interface Issue {
  key: string;
  severity: "error" | "warn";
  /** `instance` = one configuration; `connection` = an inter-instance
   *  constraint; `site` = site-structural (placement, terrain, ports). */
  scope: "instance" | "connection" | "site";
  params?: Record<string, Value>;
}

/** Carries a config-time Issue out of a throwing code path; the pipeline
 *  converts it into an invalid result, never lets it escape to the caller. */
export class ConfigError extends Error {
  constructor(readonly issue: Issue) {
    super(`Config error: ${issue.key}`);
    this.name = "ConfigError";
  }
}

/** What a derivation ran against (I3) — quotes snapshot these to be
 *  re-derivable forever: the versioned data arguments plus the exact cascade
 *  state (every override that participated, in application order). */
export interface Stamps {
  releaseId: string;
  catalogVersion: number;
  priceTableVersion: number;
  overrideIds: string[];
}

export interface CategoryTotals {
  material: number;
  accessory: number;
  manufacturing: number;
  installation: number;
  total: number;
}

/** The I10 pricing boundary: category totals as decimal strings. Computed from
 *  {@link CategoryTotals} losslessly — consumers (API/DB/PDF) never see a float. */
export type MoneyTotals = Record<keyof CategoryTotals, MoneyString>;

export interface DerivationResult {
  isValid: boolean;
  derived: Record<string, number>;
  parts: Part[];
  /** Evaluated port anchors ([x, y, z] mm, assembly space) — present only
   *  when the release declares anchors; the site plan marks connections here. */
  anchors?: Record<string, [number, number, number]>;
  totals: CategoryTotals;
  /** Decimal-as-string mirror of `totals` — the boundary representation (I10). */
  money: MoneyTotals;
  issues: Issue[];
  stamps: Stamps;
}

/**
 * The price layer fed into derivation — component unit prices plus the
 * manufacturing rate/multiplier and installation price. Injected into the
 * evaluation scope under `price.*` (CORE_SPEC §4: a tenant-overridable cascade
 * layer; slice 1 takes it as a single table).
 */
export interface PriceTable {
  /** Stamped on every result (I3) — price tables are versioned data, like the
   *  catalog; effective-date windows resolve to a version upstream. */
  version: number;
  components: Record<string, number>;
  manufacturing: { rate: number; multiplier: number };
  installation: number;
}

/** Post-cascade input values for one instance. */
export type ConfigInput = Record<string, Value>;
