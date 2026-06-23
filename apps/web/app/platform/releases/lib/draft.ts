/**
 * Turn the editor's form state into a real `ProductModelRelease` for live
 * validation + publish. The structured sections (identity, parameters,
 * constraints, derived, parts) map field-by-field; the not-yet-structured
 * sections (option sets, ports, terrain, ui, fixtures) ride raw-JSON islands that
 * are parsed here — a parse failure becomes a defect, never a thrown editor.
 * Later phases replace each island with a structured workbench.
 */
import { expr, type ProductModelRelease } from "@repo/model";

import type {
  ConstraintDraft,
  DerivedDraft,
  GeometryDraft,
  ParamDraft,
  PartDraft,
  ReleaseDraft,
  ReleaseDraftInput,
} from "./section-schemas";

type ParameterDef = ProductModelRelease["parameters"][number];
type ParamDomain = NonNullable<ParameterDef["domain"]>;
type DeviationSpec = NonNullable<ParameterDef["deviation"]>;
type PartRule = ProductModelRelease["derivation"]["parts"][number];
type ResolveSpec = PartRule["resolve"];
type BomRule = PartRule["bom"];
type GeometryRule = NonNullable<PartRule["geometry"]>[number];
type CutSpec = NonNullable<GeometryRule["cuts"]>;
type ExprStr = ReturnType<typeof expr>;
const expr3 = (a: string, b: string, c: string): [ExprStr, ExprStr, ExprStr] => [
  expr(a),
  expr(b),
  expr(c),
];

export interface IslandDefect {
  code: string;
  where: string;
  message: string;
}

export interface BuiltRelease {
  release: ProductModelRelease;
  islandDefects: IslandDefect[];
}

const num = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
};

function coerceLiteral(raw: string, type: ParamDraft["type"]): number | string | boolean {
  if (type === "length_mm" || type === "int") return num(raw) ?? 0;
  if (type === "bool") return raw.trim() === "true";
  return raw;
}

function buildDomain(p: ParamDraft): ParamDomain | undefined {
  switch (p.domainKind) {
    case "range": {
      const domain: { kind: "range"; min?: number; max?: number; step?: number } = {
        kind: "range",
      };
      const min = num(p.domainMin);
      const max = num(p.domainMax);
      const step = num(p.domainStep);
      if (min !== undefined) domain.min = min;
      if (max !== undefined) domain.max = max;
      if (step !== undefined) domain.step = step;
      return domain;
    }
    case "enum":
      return {
        kind: "enum",
        values: p.domainValues
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v !== ""),
      };
    case "pattern":
      return { kind: "pattern", pattern: p.domainPattern };
    default:
      return undefined;
  }
}

function buildDeviation(p: ParamDraft): DeviationSpec | undefined {
  if (p.deviationMode === "none") return undefined;
  const deviation: DeviationSpec = { mode: p.deviationMode };
  if (p.deviationMin.trim() !== "" || p.deviationMax.trim() !== "") {
    deviation.bounds = { min: expr(p.deviationMin), max: expr(p.deviationMax) };
  }
  if (p.deviationNote.trim() !== "") deviation.note = p.deviationNote;
  return deviation;
}

function buildParam(p: ParamDraft): ParameterDef {
  const param: ParameterDef = {
    key: p.key,
    type: p.type,
    adjustability: p.adjustability,
  };
  if (p.label.trim() !== "") param.label = p.label;
  if (p.valueMode === "literal") param.default = coerceLiteral(p.defaultLiteral, p.type);
  else if (p.valueMode === "expr") param.defaultExpr = expr(p.defaultExpr);
  const domain = buildDomain(p);
  if (domain) param.domain = domain;
  if (p.relevance.trim() !== "") param.relevance = expr(p.relevance);
  const deviation = buildDeviation(p);
  if (deviation) param.deviation = deviation;
  return param;
}

function buildGeometry(g: GeometryDraft): GeometryRule {
  const geo: GeometryRule = {
    key: g.key,
    length: expr(g.length),
    at: expr3(g.atX, g.atY, g.atZ),
  };
  if (g.useRotation) geo.rotation = expr3(g.rotX, g.rotY, g.rotZ);
  if (g.cutLeft.trim() !== "" || g.cutRight.trim() !== "") {
    const cuts: CutSpec = {};
    if (g.cutLeft.trim() !== "") cuts.left = expr(g.cutLeft);
    if (g.cutRight.trim() !== "") cuts.right = expr(g.cutRight);
    geo.cuts = cuts;
  }
  if (g.useRepeat) geo.repeat = { count: expr(g.repeatCount), var: g.repeatVar };
  return geo;
}

function buildPart(p: PartDraft): PartRule {
  const resolve: ResolveSpec = { role: p.role };
  if (p.section.trim() !== "") resolve.section = expr(p.section);
  if (p.material.trim() !== "") resolve.material = expr(p.material);
  const bom: BomRule = {
    unit: p.bomUnit,
    quantity: expr(p.bomQuantity),
    category: p.bomCategory,
  };
  if (p.bomLengthMm.trim() !== "") bom.lengthMm = expr(p.bomLengthMm);
  if (p.bomPricePerUnit.trim() !== "") bom.pricePerUnit = expr(p.bomPricePerUnit);
  if (p.bomTotalPrice.trim() !== "") bom.totalPrice = expr(p.bomTotalPrice);
  const part: PartRule = { path: p.path, name: p.name, resolve, bom };
  if (p.when.trim() !== "") part.when = expr(p.when);
  if (p.geometry.length > 0) part.geometry = p.geometry.map(buildGeometry);
  return part;
}

function parseIsland(raw: string, where: string): { value: unknown; defect?: IslandDefect } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: undefined };
  try {
    return { value: JSON.parse(trimmed) };
  } catch (error) {
    return {
      value: undefined,
      defect: {
        code: "json.parse",
        where,
        message: error instanceof Error ? error.message : "invalid JSON",
      },
    };
  }
}

export function buildReleaseFromDraft(draft: ReleaseDraft): BuiltRelease {
  const islandDefects: IslandDefect[] = [];
  const island = (raw: string, where: string): unknown => {
    const { value, defect } = parseIsland(raw, where);
    if (defect) islandDefects.push(defect);
    return value;
  };

  const optionSets = island(
    draft.optionSetsJson,
    "optionSets",
  ) as ProductModelRelease["optionSets"];
  const parts = draft.parts.map(buildPart);
  const ports = island(draft.portsJson, "ports") as ProductModelRelease["ports"];
  const terrain = island(draft.terrainJson, "terrain") as ProductModelRelease["terrain"];
  const ui = island(draft.uiJson, "ui") as ProductModelRelease["ui"];
  const fixtures = island(draft.fixturesJson, "fixtures") as ProductModelRelease["fixtures"];

  const release: ProductModelRelease = {
    id: `${draft.modelId}@${draft.version}`,
    modelId: draft.modelId,
    version: draft.version,
    status: "draft",
    parameters: draft.parameters.map(buildParam),
    constraints: draft.constraints.map((c) => ({
      key: c.key,
      kind: c.kind,
      expr: expr(c.expr),
      severity: c.severity,
      scope: c.scope,
    })),
    derivation: {
      derived: draft.derived.map((d) => ({ key: d.key, expr: expr(d.expr) })),
      parts,
    },
  };
  if (optionSets !== undefined) release.optionSets = optionSets;
  if (ports !== undefined) release.ports = ports;
  if (terrain !== undefined) release.terrain = terrain;
  if (ui !== undefined) release.ui = ui;
  if (fixtures !== undefined) release.fixtures = fixtures;

  return { release, islandDefects };
}

// --- Inverse: a published release → editor form state (Phase 3C clone-and-bump)
//     The faithful inverse of `buildReleaseFromDraft` over the editor-modeled
//     surface: every `ExprString` is a branded string, so recovering its source
//     is just `String(e)`; the not-yet-structured sections round-trip as
//     pretty-printed JSON islands. `buildReleaseFromDraft(parse(draftFromRelease
//     (r))) ≈ r` (modulo the bumped version + draft status) — proven in tests.

const exprStr = (e: ExprStr | string | undefined): string => (e == null ? "" : String(e));

const islandJson = (v: unknown): string => (v === undefined ? "" : JSON.stringify(v, null, 2));

function draftParam(p: ParameterDef): ParamDraft {
  const domain = p.domain;
  return {
    key: p.key,
    label: p.label ?? "",
    type: p.type,
    adjustability: p.adjustability,
    valueMode: p.default !== undefined ? "literal" : p.defaultExpr !== undefined ? "expr" : "none",
    defaultLiteral: p.default !== undefined ? String(p.default) : "",
    defaultExpr: exprStr(p.defaultExpr),
    relevance: exprStr(p.relevance),
    domainKind: domain?.kind ?? "none",
    domainMin: domain?.kind === "range" && domain.min !== undefined ? String(domain.min) : "",
    domainMax: domain?.kind === "range" && domain.max !== undefined ? String(domain.max) : "",
    domainStep: domain?.kind === "range" && domain.step !== undefined ? String(domain.step) : "",
    domainValues: domain?.kind === "enum" ? domain.values.join(", ") : "",
    domainPattern: domain?.kind === "pattern" ? domain.pattern : "",
    deviationMode: p.deviation?.mode ?? "none",
    deviationMin: exprStr(p.deviation?.bounds?.min),
    deviationMax: exprStr(p.deviation?.bounds?.max),
    deviationNote: p.deviation?.note ?? "",
  };
}

function draftGeometry(g: GeometryRule): GeometryDraft {
  return {
    key: g.key,
    length: exprStr(g.length),
    atX: exprStr(g.at[0]),
    atY: exprStr(g.at[1]),
    atZ: exprStr(g.at[2]),
    useRotation: g.rotation !== undefined,
    rotX: g.rotation ? exprStr(g.rotation[0]) : "0",
    rotY: g.rotation ? exprStr(g.rotation[1]) : "0",
    rotZ: g.rotation ? exprStr(g.rotation[2]) : "0",
    cutLeft: exprStr(g.cuts?.left),
    cutRight: exprStr(g.cuts?.right),
    useRepeat: g.repeat !== undefined,
    repeatCount: g.repeat ? exprStr(g.repeat.count) : "",
    repeatVar: g.repeat?.var ?? "",
  };
}

function draftPart(p: PartRule): PartDraft {
  return {
    path: p.path,
    name: p.name,
    role: p.resolve.role,
    section: exprStr(p.resolve.section),
    material: exprStr(p.resolve.material),
    when: exprStr(p.when),
    bomUnit: p.bom.unit,
    bomQuantity: exprStr(p.bom.quantity),
    bomLengthMm: exprStr(p.bom.lengthMm),
    bomPricePerUnit: exprStr(p.bom.pricePerUnit),
    bomTotalPrice: exprStr(p.bom.totalPrice),
    bomCategory: p.bom.category,
    geometry: (p.geometry ?? []).map(draftGeometry),
  };
}

/**
 * Seed the editor from a published release for clone-and-bump (Phase 3C). The
 * caller supplies the bumped `version` (e.g. source + 1) and the `catalogVersion`
 * to validate against (carried from the source row); `modelId` stays, so publish
 * freezes a NEW "modelId@version" through the existing immutable path.
 */
export function draftFromRelease(
  release: ProductModelRelease,
  version: number,
  catalogVersion: number,
): ReleaseDraftInput {
  return {
    modelId: release.modelId,
    version,
    catalogVersion,
    parameters: release.parameters.map(draftParam),
    constraints: release.constraints.map((c) => ({
      key: c.key,
      kind: c.kind,
      expr: exprStr(c.expr),
      severity: c.severity,
      scope: c.scope,
    })),
    derived: release.derivation.derived.map((d) => ({ key: d.key, expr: exprStr(d.expr) })),
    parts: release.derivation.parts.map(draftPart),
    optionSetsJson: islandJson(release.optionSets),
    portsJson: islandJson(release.ports),
    terrainJson: islandJson(release.terrain),
    uiJson: islandJson(release.ui),
    fixturesJson: islandJson(release.fixtures),
  };
}

/** A fresh, empty draft — the editor's starting state. */
export function blankDraft(): ReleaseDraftInput {
  return {
    modelId: "",
    version: 1,
    catalogVersion: 1,
    parameters: [],
    constraints: [],
    derived: [],
    parts: [],
    optionSetsJson: "",
    portsJson: "",
    terrainJson: "",
    uiJson: "",
    fixturesJson: "",
  };
}

/** A new part rule's defaults — a meter of catalog material in one BOM line. */
export function blankPart(): PartDraft {
  return {
    path: "",
    name: "",
    role: "",
    section: "",
    material: "",
    when: "",
    bomUnit: "meter",
    bomQuantity: "",
    bomLengthMm: "",
    bomPricePerUnit: "",
    bomTotalPrice: "",
    bomCategory: "material",
    geometry: [],
  };
}

/** A new geometry piece's defaults — a single bar at the origin, no repeat. */
export function blankGeometry(): GeometryDraft {
  return {
    key: "",
    length: "",
    atX: "0",
    atY: "0",
    atZ: "0",
    useRotation: false,
    rotX: "0",
    rotY: "0",
    rotZ: "0",
    cutLeft: "",
    cutRight: "",
    useRepeat: false,
    repeatCount: "",
    repeatVar: "",
  };
}

/** A new constraint row's defaults. */
export function blankConstraint(): ConstraintDraft {
  return { key: "", kind: "expr", expr: "", severity: "error", scope: "instance" };
}

/** A new derived-dimension row's defaults. */
export function blankDerived(): DerivedDraft {
  return { key: "", expr: "" };
}

/** A new parameter row's defaults. */
export function blankParam(): ParamDraft {
  return {
    key: "",
    label: "",
    type: "length_mm",
    adjustability: "user",
    valueMode: "none",
    defaultLiteral: "",
    defaultExpr: "",
    relevance: "",
    domainKind: "none",
    domainMin: "",
    domainMax: "",
    domainStep: "",
    domainValues: "",
    domainPattern: "",
    deviationMode: "none",
    deviationMin: "",
    deviationMax: "",
    deviationNote: "",
  };
}
