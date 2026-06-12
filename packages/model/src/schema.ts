/**
 * The product-model schema (CORE_SPEC §2/§3) — the conceptual contract a
 * generic engine interprets. Authoring is vendor-only (CORE_SPEC §3); tenants
 * are *assigned* releases and never see these shapes.
 *
 * Slice 1 (CORE_SPEC §10 step 1) implements the subset needed to author and
 * derive ONE product (the sliding gate) and prove I1/I2 delta-0:
 *   - parameters, option sets, constraints, derivation (derived + parts).
 * Reserved-but-not-yet-built fields are marked; they land in later steps
 * (catalog/role resolution §2, ports/joints §5, ui/fixtures §3) without
 * breaking authored models.
 */
import type { ExprString } from "./expr";

/** Lengths are integer mm (I10). A branding seam — enforced at the I/O edge,
 *  not yet at the type level, so derived intermediates (e.g. a fractional fill
 *  pitch) stay exact through the engine. */
export type Mm = number;

/** Money is decimal-as-string with a currency (I10). Slice 1 computes prices in
 *  the deterministic IEEE-754 numeric domain (see ADR 0045) and formats to this
 *  representation at the result boundary; exact-decimal arithmetic hardens with
 *  the pricing/cascade layer (CORE_SPEC §10 step 3). */
export type MoneyString = string;

export type ParamType = "length_mm" | "int" | "select" | "multiselect" | "bool" | "color" | "text";

/** I7 — the schema, not UI convention, decides who may write a value. */
export type Adjustability = "vendor" | "tenant" | "user";

/** The "but not there" knowledge (CORE_SPEC §3): free / needs-reason / hard limit. */
export type DeviationMode = "free" | "warn" | "hard";

export interface DeviationSpec {
  mode: DeviationMode;
  bounds?: { min: ExprString; max: ExprString };
  /** Why the limit exists ("diagonal below X sags") — shown on warn/hard. */
  note?: string;
}

export type ParamDomain =
  | { kind: "range"; min?: number; max?: number; step?: number }
  | { kind: "enum"; values: string[] }
  | { kind: "pattern"; pattern: string };

export interface ParameterDef {
  key: string;
  type: ParamType;
  domain?: ParamDomain;
  /** Resolved default — a literal or an expression (may reference other layers,
   *  e.g. a price-table value injected as `price.*`). */
  default?: ExprString | number | string | boolean;
  adjustability: Adjustability;
  deviation?: DeviationSpec;
  /** UI shows the parameter only when this evaluates true (generated UI). */
  relevance?: ExprString;
}

/**
 * An option set is the slice-1 mechanism for option-carried attributes
 * (CORE_SPEC §8 generated UI; precursor to the §2 catalog). Selecting an
 * option by its id injects that option's `attrs` into the derivation scope
 * under `<key>.<attr>` (e.g. `fill.min_spacing_mm`).
 */
export interface OptionSet {
  /** Scope prefix the chosen option's attrs are injected under (e.g. "fill"). */
  key: string;
  /** The parameter whose value selects the option (e.g. "fill_type_id"). */
  selectedBy: string;
  options: OptionDef[];
}

export interface OptionDef {
  id: string;
  label?: string;
  attrs: Record<string, number | string | boolean | null>;
}

/** Declarative constraint (CORE_SPEC §3). `key` doubles as the i18n message key
 *  (the validator-keys discipline carries over from the MVP). */
export interface ConstraintDef {
  key: string;
  kind: "range" | "requires" | "excludes" | "expr";
  /** Must evaluate true; otherwise an Issue of `severity` is raised. */
  expr: ExprString;
  severity: "error" | "warn";
  /** instance-scope today; connection-scope (inter-instance) lands with §5. */
  scope: "instance" | "connection";
}

export type BomCategory = "material" | "accessory" | "manufacturing" | "installation";
export type BomUnit = "meter" | "piece" | "set" | "hour";

/** What one line of the bill of materials costs and counts. */
export interface BomRule {
  unit: BomUnit;
  quantity: ExprString;
  /** Run-length / per-piece length, mm — carried for the cut list & drawings. */
  lengthMm?: ExprString;
  /** Explicit unit price; when omitted the emitter resolves `price.<code>`. */
  pricePerUnit?: ExprString;
  /** Explicit total; when set it wins over `quantity × unit price` (I5: no
   *  silent zero — a line that should be a fixed/threshold price says so). */
  totalPrice?: ExprString;
  category: BomCategory;
}

/**
 * A part rule generates 1..n parts (CORE_SPEC §3). Slice 1 names the component
 * code directly (single-material; role-based resolution against the catalog is
 * §2 / step 2). `geometry` (length/cuts/transform) is reserved for the
 * renderers (step 5); slice 1 proves BOM + price.
 */
export interface PartRule {
  /** Stable id root (I9) — survives re-derivation so overrides/annotations stick. */
  path: string;
  componentCode: string;
  /**
   * When set, the component code is resolved at derive time from this
   * expression (it must evaluate to a string), overriding {@link componentCode}.
   * Slice-1 bridge for option-driven components (e.g. the chosen fill's
   * `fill.material_component_code`); superseded by role-based catalog
   * resolution (CORE_SPEC §2 / step 2), where the recipe requests
   * `{role, section, material}` instead of naming a code.
   */
  componentCodeExpr?: ExprString;
  name: string;
  /** Conditional inclusion (e.g. only when `include_motor`). */
  when?: ExprString;
  bom: BomRule;
}

export interface DerivedDef {
  key: string;
  expr: ExprString;
}

export interface DerivationRecipe {
  /** Named dimensions, evaluated in order; each may reference earlier ones. */
  derived: DerivedDef[];
  parts: PartRule[];
  // joints: reserved for the site graph (CORE_SPEC §5 / step 4).
}

export type ReleaseStatus = "draft" | "published" | "retired";

/**
 * An immutable, vendor-authored published version of a product model's full
 * definition (CORE_SPEC §3). `id` is `"<modelId>@<version>"`.
 */
export interface ProductModelRelease {
  id: string;
  modelId: string;
  version: number;
  status: ReleaseStatus;
  parameters: ParameterDef[];
  optionSets?: OptionSet[];
  constraints: ConstraintDef[];
  derivation: DerivationRecipe;
  // ports, ui, fixtures: reserved (CORE_SPEC §3) — land with later steps.
}

/** A golden fixture (CORE_SPEC I2): a config + its expected outputs. Publishing
 *  a release requires its fixtures to pass. */
export interface GoldenFixture {
  name: string;
  /** Excel-anchored (delta-0 source) vs regression-lock only. */
  anchored: boolean;
  config: Record<string, number | string | boolean>;
  expected: {
    derived?: Record<string, number>;
    totalPrice?: number;
  };
}
