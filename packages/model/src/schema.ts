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
import type { ExprString } from "./expr.js";

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
  /** Vendor-authored display label (product language, Czech for CZ tenants) —
   *  the generated UI (CORE_SPEC §8) falls back to `key` when absent. Domain
   *  wording is release DATA, not an app i18n catalog: a new family must ship
   *  its own working wizard without touching app code. */
  label?: string;
  type: ParamType;
  domain?: ParamDomain;
  /** Literal default. Mutually exclusive with {@link defaultExpr} — a string
   *  literal and a serialized expression are indistinguishable at runtime
   *  (releases are stored data), so the schema, not a brand, discriminates. */
  default?: number | string | boolean;
  /** Expression default (may reference earlier parameters and `price.*`). */
  defaultExpr?: ExprString;
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
  /** `instance` evaluates against one configuration; `connection` evaluates
   *  once per connected end against a paired scope where `self.*` is this
   *  release's values (params + option attrs + derived) and `other.*` the
   *  opposite end's (CORE_SPEC §5). */
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
 * The catalog resolution request (CORE_SPEC §2) — THE one mechanism by which a
 * recipe names physical reality. A rule never names a component code; it
 * requests a semantic role, optionally constrained by section and material
 * (both expressions, so the same model yields aluminum or steel by switching a
 * material parameter). Resolution failure is an I5 hard error carrying the
 * missing (role, section, material) triple — which doubles as the vendor's
 * "what to add to the catalog" worklist.
 */
export interface ResolveSpec {
  role: string;
  /** Must evaluate to a SectionProfile.code (string). */
  section?: ExprString;
  /** Must evaluate to a Material.code (string). */
  material?: ExprString;
}

/** Mitre angles at a piece's two ends, authored in decimal degrees measured
 *  from the piece axis (omitted end = square 90° cut). The engine emits
 *  integer arc-minutes (I10) — presentation divides by 60. */
export interface CutSpec {
  left?: ExprString;
  right?: ExprString;
}

/**
 * One keyed group of physical pieces a part rule emits for the renderers
 * (CORE_SPEC §3 geometry / step 5). A BOM line and its physical pieces are
 * different truths: `frame.lprofile` bills rolled-up meters but cuts five
 * distinct pieces (postA, postB, diagonal, …) — each is one GeometryRule.
 * Pieces live in assembly space (X across, Y up, Z toward the viewer; mm),
 * length runs along the piece's local X axis before rotation. `repeat` lays
 * out count pieces with `var` injected into the expression scope (fill
 * lamella i at `100 + i * spacing`). Piece ids are `<key>` / `<key>[i]` under
 * the part path (I9 — never array position).
 */
export interface GeometryRule {
  /** Unique within the part; an identifier (no dots/brackets — it addresses). */
  key: string;
  /** Piece length along local X, mm. */
  length: ExprString;
  /** Assembly-space origin [x, y, z], mm. May reference `repeat.var`. */
  at: [ExprString, ExprString, ExprString];
  /** Rotation about [X, Y, Z], authored in decimal degrees; the engine emits
   *  integer arc-minutes (I10). Omitted = unrotated (length along X). */
  rotation?: [ExprString, ExprString, ExprString];
  cuts?: CutSpec;
  /** Emit `count` pieces with `var` bound to 0..count-1 in this rule's scope. */
  repeat?: { count: ExprString; var: string };
}

/**
 * A part rule generates 1..n parts (CORE_SPEC §3). The component is resolved
 * from the catalog via {@link ResolveSpec} — never named directly (the slice-1
 * `componentCode`/`componentCodeExpr` bridge is dead; one resolution mechanism
 * only).
 */
export interface PartRule {
  /** Stable id root (I9) — survives re-derivation so overrides/annotations stick. */
  path: string;
  resolve: ResolveSpec;
  name: string;
  /** Conditional inclusion (e.g. only when `include_motor`). */
  when?: ExprString;
  bom: BomRule;
  /** Physical pieces for the renderers (step 5). A part without geometry is
   *  BOM-only (labor, kits, motors) and never appears in scene/drawing/cuts. */
  geometry?: GeometryRule[];
}

export interface DerivedDef {
  key: string;
  expr: ExprString;
}

export interface DerivationRecipe {
  /** Named dimensions, evaluated in order; each may reference earlier ones. */
  derived: DerivedDef[];
  parts: PartRule[];
  // joints: reserved (CORE_SPEC §3) — no authored model needs them yet; piece
  // geometry (step 5) carries the renderers without joint records.
}

/** Which side of a connection provides the shared element (I6). */
export type SharingPolicy = "owner" | "consumer";

/**
 * What a port shares with whatever connects to it (CORE_SPEC §3/§5, I6):
 * `owner` keeps its element and PROVIDES it to the connection; `consumer`
 * DROPS its own element (it exists only while the port is unconnected — a
 * standalone fence run still has its start post) and attaches to the owner's.
 * Resolution rule: a connection may have at most one consumer end, and a
 * consumer requires the opposite port to declare an element to consume.
 */
export interface PortSharing {
  /** PartRule.path of the element this port carries (validated at publish). */
  element: string;
  policy: SharingPolicy;
}

/**
 * A connection point on the assembly (CORE_SPEC §3/§5). Ports connect only
 * when their kinds are MUTUALLY compatible (each kind listed by the other
 * port) — vendor-only authoring makes the symmetry enforceable. Declaring a
 * kind compatible is a contract: your connection-scope constraints must
 * evaluate against every release exposing that kind (their `other.*` refs
 * must exist there).
 */
export interface PortDef {
  id: string;
  /** Semantic kind ("fence.end", "gate.side", "post.top"). */
  kind: string;
  compatibleKinds: string[];
  sharing?: PortSharing;
  /** Where the port sits in assembly space ([x, y, z] mm, expr-driven) — the
   *  site plan marks connections here; step-6 canvas snapping builds on it. */
  anchor?: { at: [ExprString, ExprString, ExprString] };
}

/** Binds the site's stepped terrain to this model: a placement on a terrain
 *  segment writes the segment's elevation into the named parameter through
 *  the ordinary input gate — one write path, no side door (CORE_SPEC §5). */
export interface TerrainBinding {
  /** Key of a declared length_mm parameter (validated at publish). */
  elevationParam: string;
}

/** One labeled run of parameters inside a step (CORE_SPEC §8). */
export interface UiGroup {
  id: string;
  /** Vendor-authored display label; falls back to `id`. */
  label?: string;
  /** ParameterDef.keys in display order. Validated at publish: every key must
   *  exist, appear once across the whole spec, and never be vendor-only (I7 —
   *  the generated surface renders exactly what tenants/users may write). */
  params: string[];
}

/** One wizard step (CORE_SPEC §8). */
export interface UiStep {
  id: string;
  label?: string;
  groups: UiGroup[];
}

/**
 * The generated-UI spec (CORE_SPEC §8): steps, groups, ordering, and labels
 * come from the model — a new product family ships with a working wizard, no
 * app code. Per-parameter VISIBILITY stays on `ParameterDef.relevance` (the
 * value-dependent part); the spec is pure structure. Publishing requires every
 * non-vendor parameter to appear exactly once (an uncovered writable parameter
 * would be silently uneditable — the I5 spirit applied to the surface).
 */
export interface UiSpec {
  steps: UiStep[];
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
  /** Connection points for the site graph (CORE_SPEC §5 / step 4). */
  ports?: PortDef[];
  /** Stepped-terrain participation (CORE_SPEC §5 / step 4). */
  terrain?: TerrainBinding;
  /** Generated-UI structure (CORE_SPEC §8 / step 6). Absent = the consumer
   *  falls back to one synthesized step over all writable parameters. */
  ui?: UiSpec;
  // fixtures: reserved (CORE_SPEC §3) — lands with authoring tooling.
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
