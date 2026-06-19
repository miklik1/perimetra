/**
 * validateRelease — the publish gate (CORE_SPEC §3, I2/I9): a release with
 * defects cannot be published, and the fixtures harness runs the same gate so
 * authoring errors die at test time, BEFORE a model ships. These are
 * AUTHOR-time errors — vendor-shaped, so they throw/report as defects, never
 * as user-facing Issues (the engine's config-time taxonomy).
 *
 * Checks:
 *   - every expression parses and calls only whitelisted functions
 *   - key uniqueness: parameters, derived, constraints, option sets, ports
 *   - part paths unique (I9 — stable addressing dies on duplicates)
 *   - every expr reference resolves against what its evaluation scope will
 *     actually contain (params, earlier derived, option attrs, price.*).
 *     Connection-scope constraints are special: refs must be `self.*` /
 *     `other.*`; `self.X` is checked against this release's full scope
 *     (params + option attrs + derived), `other.*` cannot be checked
 *     statically — declaring a port kind compatible is the vendor's contract
 *     that the refs exist on every release exposing that kind (CORE_SPEC §5)
 *   - geometry: keys unique identifiers per part; repeat vars don't shadow
 *     scope names; piece/anchor exprs check like any other slot
 *   - ports: sharing elements name real part paths; the terrain binding
 *     names a writable length_mm parameter
 *   - ui (when authored): refs name real parameters, each writable parameter
 *     appears exactly once, vendor-only parameters never appear (I7)
 *   - against a catalog: every resolve.role exists, and literal
 *     section/material requests name real catalog codes
 *
 * The per-slot evaluation scope (which dotted keys are legal in each
 * expression) is computed ONCE by {@link slotScopes} and CONSUMED here — so the
 * editor's autocomplete and this gate can never drift (a single source of scope
 * truth, keyed by the same `where` strings).
 */
import type { Catalog } from "./catalog.js";
import { collectCalls, collectRefs, ExprError, isKnownFunction, parse, type Ast } from "./expr.js";
import type { ProductModelRelease } from "./schema.js";

export interface ReleaseDefect {
  /** Machine code, e.g. "expr.parse", "key.duplicate", "ref.unknown". */
  code: string;
  /** Where in the release ("parts[rail.set].bom.quantity", "derived[postA]"). */
  where: string;
  message: string;
}

export class ReleaseValidationError extends Error {
  constructor(readonly defects: ReleaseDefect[]) {
    super(
      `Release validation failed with ${defects.length} defect(s):\n` +
        defects.map((d) => `  [${d.code}] ${d.where}: ${d.message}`).join("\n"),
    );
    this.name = "ReleaseValidationError";
  }
}

/** A parsed expression slot awaiting reference checking. */
interface Slot {
  where: string;
  ast: Ast;
  /** Names this slot's evaluation scope will contain. */
  known: ReadonlySet<string>;
  /** Ref prefixes that are open-keyed in this slot's scope (uncheckable
   *  statically): `price.` everywhere, `other.` in connection constraints. */
  openPrefixes: readonly string[];
}

const PRICE_PREFIX = "price.";
const OTHER_PREFIX = "other.";
const PRICE_ONLY: readonly string[] = [PRICE_PREFIX];
const OTHER_ONLY: readonly string[] = [OTHER_PREFIX];
const EMPTY_KNOWN: ReadonlySet<string> = new Set();

/**
 * The static evaluation scope of a single expression slot: the dotted-key names
 * that will be in scope, plus the prefixes that are open-keyed (uncheckable
 * statically). `known` is exactly what {@link validateRelease} reference-checks
 * against, and what the release editor offers as in-scope autocomplete.
 */
export interface ExprScope {
  known: ReadonlySet<string>;
  openPrefixes: readonly string[];
}

/**
 * Compute the evaluation scope of every expression slot in a release, keyed by
 * the same `where` strings {@link validateRelease} emits
 * (`parameters[<key>].defaultExpr`, `derived[<key>]`,
 * `parts[<path>].bom.quantity`, `parts[<path>].geometry[<gk>].at[0]`, …).
 *
 * Pure and static — depends only on the release's shape, never on evaluated
 * values — so an authoring surface can recompute it live as the draft changes.
 * `validateRelease` consumes this map, so the two never disagree about what is
 * in scope where. (A duplicate key/path collapses to the last occurrence's
 * scope; duplicates are themselves a hard defect surfaced by `validateRelease`.)
 */
export function slotScopes(release: ProductModelRelease): Map<string, ExprScope> {
  const scopes = new Map<string, ExprScope>();
  const add = (
    where: string,
    known: ReadonlySet<string>,
    openPrefixes: readonly string[] = PRICE_ONLY,
  ): void => {
    scopes.set(where, { known, openPrefixes });
  };

  // --- Name universes (the shape of the scope, before any per-slot snapshot) --
  const paramKeys = new Set<string>();
  for (const p of release.parameters) paramKeys.add(p.key);

  // Option attrs are injected as `<set.key>.<attr>`; the known set is the union
  // across the set's options.
  const optionAttrKeys = new Set<string>();
  for (const set of release.optionSets ?? []) {
    for (const option of set.options) {
      for (const attr of Object.keys(option.attrs)) optionAttrKeys.add(`${set.key}.${attr}`);
    }
  }

  // Parameters: defaults see price.* + EARLIER params only (buildScope order);
  // relevance + deviation bounds see the full param/option-attr universe.
  const uiKnown = new Set([...paramKeys, ...optionAttrKeys]);
  const earlier = new Set<string>();
  for (const p of release.parameters) {
    if (p.defaultExpr !== undefined) {
      add(`parameters[${p.key}].defaultExpr`, new Set(earlier));
    }
    earlier.add(p.key);
    if (p.relevance !== undefined) add(`parameters[${p.key}].relevance`, uiKnown);
    if (p.deviation?.bounds) {
      add(`parameters[${p.key}].deviation.min`, uiKnown);
      add(`parameters[${p.key}].deviation.max`, uiKnown);
    }
  }

  // Constraints. Instance scope is evaluated BEFORE derivation (derived keys are
  // not in scope). Connection scope sees `self.*` (this release's params +
  // option attrs + derived) and the open `other.*` prefix.
  const constraintKnown = new Set([...paramKeys, ...optionAttrKeys]);
  const connectionSelfKnown = new Set(
    [...paramKeys, ...optionAttrKeys, ...release.derivation.derived.map((d) => d.key)].map(
      (key) => `self.${key}`,
    ),
  );
  for (const c of release.constraints) {
    if (c.scope === "connection") add(`constraints[${c.key}]`, connectionSelfKnown, OTHER_ONLY);
    else add(`constraints[${c.key}]`, constraintKnown);
  }

  // Derived: each sees params, option attrs, and EARLIER derived keys.
  const derivedSoFar = new Set<string>();
  for (const d of release.derivation.derived) {
    add(`derived[${d.key}]`, new Set([...constraintKnown, ...derivedSoFar]));
    derivedSoFar.add(d.key);
  }

  // Parts: full scope (params + option attrs + all derived).
  const partKnown = new Set([...constraintKnown, ...derivedSoFar]);
  for (const rule of release.derivation.parts) {
    const at = `parts[${rule.path}]`;
    if (rule.when !== undefined) add(`${at}.when`, partKnown);
    if (rule.resolve.section !== undefined) add(`${at}.resolve.section`, partKnown);
    if (rule.resolve.material !== undefined) add(`${at}.resolve.material`, partKnown);
    add(`${at}.bom.quantity`, partKnown);
    if (rule.bom.lengthMm !== undefined) add(`${at}.bom.lengthMm`, partKnown);
    if (rule.bom.pricePerUnit !== undefined) add(`${at}.bom.pricePerUnit`, partKnown);
    if (rule.bom.totalPrice !== undefined) add(`${at}.bom.totalPrice`, partKnown);

    for (const geo of rule.geometry ?? []) {
      const geoAt = `${at}.geometry[${geo.key}]`;
      let geoKnown: ReadonlySet<string> = partKnown;
      if (geo.repeat !== undefined) {
        // The count decides how many pieces exist — it cannot see the var.
        add(`${geoAt}.repeat.count`, partKnown);
        geoKnown = new Set([...partKnown, geo.repeat.var]);
      }
      add(`${geoAt}.length`, geoKnown);
      geo.at.forEach((_, i) => add(`${geoAt}.at[${i}]`, geoKnown));
      geo.rotation?.forEach((_, i) => add(`${geoAt}.rotation[${i}]`, geoKnown));
      if (geo.cuts?.left !== undefined) add(`${geoAt}.cuts.left`, geoKnown);
      if (geo.cuts?.right !== undefined) add(`${geoAt}.cuts.right`, geoKnown);
    }
  }

  // Ports: anchor exprs see the full part scope.
  for (const port of release.ports ?? []) {
    port.anchor?.at.forEach((_, i) => add(`ports[${port.id}].anchor.at[${i}]`, partKnown));
  }

  return scopes;
}

export function validateRelease(release: ProductModelRelease, catalog?: Catalog): ReleaseDefect[] {
  const defects: ReleaseDefect[] = [];
  const slots: Slot[] = [];

  // The single source of scope truth — every expr slot's legal references.
  const scopes = slotScopes(release);

  const parseInto = (source: string, where: string): void => {
    const scope = scopes.get(where);
    const known = scope?.known ?? EMPTY_KNOWN;
    const openPrefixes = scope?.openPrefixes ?? PRICE_ONLY;
    try {
      slots.push({ where, ast: parse(source), known, openPrefixes });
    } catch (error) {
      if (!(error instanceof ExprError)) throw error;
      defects.push({ code: "expr.parse", where, message: error.message });
    }
  };

  const duplicate = (kind: string, where: string, key: string): ReleaseDefect => ({
    code: "key.duplicate",
    where,
    message: `${kind} "${key}" is declared more than once`,
  });

  // --- Parameter keys: unique, no dotted names (reserved for injected layers) -
  const paramKeys = new Set<string>();
  for (const p of release.parameters) {
    if (paramKeys.has(p.key)) defects.push(duplicate("parameter", `parameters[${p.key}]`, p.key));
    if (p.key.includes(".")) {
      defects.push({
        code: "key.dotted",
        where: `parameters[${p.key}]`,
        message: `parameter keys must not contain "." (dotted names are reserved for injected layers)`,
      });
    }
    paramKeys.add(p.key);
  }

  // --- Option sets: unique keys, no collision with a param, real selectedBy ---
  const seenSetKeys = new Set<string>();
  for (const set of release.optionSets ?? []) {
    if (seenSetKeys.has(set.key)) {
      defects.push(duplicate("option set", `optionSets[${set.key}]`, set.key));
    }
    seenSetKeys.add(set.key);
    if (paramKeys.has(set.key)) {
      defects.push({
        code: "key.collision",
        where: `optionSets[${set.key}]`,
        message: `option set key "${set.key}" collides with a parameter key`,
      });
    }
    if (!paramKeys.has(set.selectedBy)) {
      defects.push({
        code: "ref.unknown",
        where: `optionSets[${set.key}].selectedBy`,
        message: `selectedBy "${set.selectedBy}" is not a declared parameter`,
      });
    }
  }

  // --- Parameters: default/defaultExpr exclusivity, bounded "hard" deviations,
  // and parse of every defaultExpr / relevance / deviation-bound expression.
  for (const p of release.parameters) {
    if (p.default !== undefined && p.defaultExpr !== undefined) {
      defects.push({
        code: "default.ambiguous",
        where: `parameters[${p.key}]`,
        message: "default and defaultExpr are mutually exclusive",
      });
    }
    if (p.defaultExpr !== undefined) {
      parseInto(p.defaultExpr, `parameters[${p.key}].defaultExpr`);
    }
    if (p.relevance !== undefined) parseInto(p.relevance, `parameters[${p.key}].relevance`);
    if (p.deviation?.bounds) {
      parseInto(p.deviation.bounds.min, `parameters[${p.key}].deviation.min`);
      parseInto(p.deviation.bounds.max, `parameters[${p.key}].deviation.max`);
    }
    if (p.deviation?.mode === "hard" && p.deviation.bounds === undefined) {
      // "hard" means the bounds ARE the structural limit — without them the
      // mode is unenforceable and the authored knowledge is incomplete.
      defects.push({
        code: "deviation.unbounded",
        where: `parameters[${p.key}].deviation`,
        message: `deviation mode "hard" requires bounds`,
      });
    }
  }

  // --- Constraints: unique keys; parse instance/connection exprs ----------------
  const seenConstraintKeys = new Set<string>();
  for (const c of release.constraints) {
    if (seenConstraintKeys.has(c.key)) {
      defects.push(duplicate("constraint", `constraints[${c.key}]`, c.key));
    }
    seenConstraintKeys.add(c.key);
    parseInto(c.expr, `constraints[${c.key}]`);
  }

  // --- Derived: unique keys (also vs params); parse each expr ------------------
  const derivedSoFar = new Set<string>();
  for (const d of release.derivation.derived) {
    if (derivedSoFar.has(d.key) || paramKeys.has(d.key)) {
      defects.push(duplicate("derived key", `derived[${d.key}]`, d.key));
    }
    parseInto(d.expr, `derived[${d.key}]`);
    derivedSoFar.add(d.key);
  }

  // --- Parts: paths unique (I9); parse when/resolve/bom; geometry hygiene ------
  const seenPaths = new Set<string>();
  for (const rule of release.derivation.parts) {
    const at = `parts[${rule.path}]`;
    if (seenPaths.has(rule.path)) {
      defects.push({
        code: "path.duplicate",
        where: at,
        message: `part path "${rule.path}" is not unique — stable addressing (I9) requires it`,
      });
    }
    seenPaths.add(rule.path);

    if (rule.when !== undefined) parseInto(rule.when, `${at}.when`);
    if (rule.resolve.section !== undefined) {
      parseInto(rule.resolve.section, `${at}.resolve.section`);
    }
    if (rule.resolve.material !== undefined) {
      parseInto(rule.resolve.material, `${at}.resolve.material`);
    }
    parseInto(rule.bom.quantity, `${at}.bom.quantity`);
    if (rule.bom.lengthMm !== undefined) parseInto(rule.bom.lengthMm, `${at}.bom.lengthMm`);
    if (rule.bom.pricePerUnit !== undefined) {
      parseInto(rule.bom.pricePerUnit, `${at}.bom.pricePerUnit`);
    }
    if (rule.bom.totalPrice !== undefined) {
      parseInto(rule.bom.totalPrice, `${at}.bom.totalPrice`);
    }

    // --- Geometry (step 5): keyed pieces, repeat var hygiene, expr refs ------
    const seenGeometryKeys = new Set<string>();
    for (const geo of rule.geometry ?? []) {
      const geoAt = `${at}.geometry[${geo.key}]`;
      if (seenGeometryKeys.has(geo.key)) {
        defects.push(duplicate("geometry key", geoAt, geo.key));
      }
      seenGeometryKeys.add(geo.key);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(geo.key)) {
        defects.push({
          code: "key.invalid",
          where: geoAt,
          message: `geometry key "${geo.key}" must be an identifier — piece ids build on it (I9)`,
        });
      }
      if (geo.repeat !== undefined) {
        // The count decides how many pieces exist — it cannot see the var.
        parseInto(geo.repeat.count, `${geoAt}.repeat.count`);
        const v = geo.repeat.var;
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) || partHas(release, v)) {
          defects.push({
            code: "repeat.var.invalid",
            where: `${geoAt}.repeat.var`,
            message: `repeat var "${v}" must be an identifier and must not shadow a scope name`,
          });
        }
      }
      parseInto(geo.length, `${geoAt}.length`);
      geo.at.forEach((source, i) => parseInto(source, `${geoAt}.at[${i}]`));
      geo.rotation?.forEach((source, i) => parseInto(source, `${geoAt}.rotation[${i}]`));
      if (geo.cuts?.left !== undefined) parseInto(geo.cuts.left, `${geoAt}.cuts.left`);
      if (geo.cuts?.right !== undefined) parseInto(geo.cuts.right, `${geoAt}.cuts.right`);
    }

    if (catalog) {
      const { role, section, material } = rule.resolve;
      if (!catalog.components.some((c) => c.roles.includes(role))) {
        defects.push({
          code: "catalog.role.unknown",
          where: `${at}.resolve.role`,
          message: `no catalog component carries role "${role}"`,
        });
      }
      // Literal section/material requests can be checked statically; parameter-
      // driven ones resolve (or I5-fail) at derive time.
      for (const [axis, source, codes] of [
        ["section", section, catalog.sections.map((s) => s.code)],
        ["material", material, catalog.materials.map((m) => m.code)],
      ] as const) {
        if (source === undefined) continue;
        try {
          const ast = parse(source);
          if (ast.k === "str" && !codes.includes(ast.v)) {
            defects.push({
              code: `catalog.${axis}.unknown`,
              where: `${at}.resolve.${axis}`,
              message: `"${ast.v}" is not a catalog ${axis} code`,
            });
          }
        } catch {
          // parse defect already recorded above
        }
      }
    }
  }

  // --- Ports (CORE_SPEC §5): unique ids, sharing elements are real part paths,
  // anchor exprs parse (scope checked in the slot pass below).
  const seenPortIds = new Set<string>();
  for (const port of release.ports ?? []) {
    if (seenPortIds.has(port.id)) defects.push(duplicate("port", `ports[${port.id}]`, port.id));
    seenPortIds.add(port.id);
    if (port.sharing !== undefined && !seenPaths.has(port.sharing.element)) {
      defects.push({
        code: "port.element.unknown",
        where: `ports[${port.id}].sharing.element`,
        message: `"${port.sharing.element}" is not a part path of this release`,
      });
    }
    port.anchor?.at.forEach((source, i) => {
      parseInto(source, `ports[${port.id}].anchor.at[${i}]`);
    });
  }

  // --- Terrain binding: must name a writable length parameter — the engine
  // injects elevation through the ordinary input gate (one write path, I7).
  if (release.terrain !== undefined) {
    const key = release.terrain.elevationParam;
    const param = release.parameters.find((p) => p.key === key);
    if (param === undefined) {
      defects.push({
        code: "terrain.param.unknown",
        where: "terrain.elevationParam",
        message: `"${key}" is not a declared parameter`,
      });
    } else if (param.type !== "length_mm") {
      defects.push({
        code: "terrain.param.type",
        where: "terrain.elevationParam",
        message: `"${key}" must be a length_mm parameter, is ${param.type}`,
      });
    } else if (param.adjustability === "vendor") {
      defects.push({
        code: "terrain.param.unwritable",
        where: "terrain.elevationParam",
        message: `"${key}" is vendor-only — the input gate would reject every placement (I7)`,
      });
    }
  }

  // --- Generated UI (CORE_SPEC §8): refs resolve, each writable parameter
  // appears exactly once, vendor-only parameters never appear (I7 — the spec
  // IS the tenant-facing surface). Coverage is checked only when `ui` is
  // authored; an absent spec falls back to defaultUi at render time.
  if (release.ui !== undefined) {
    const paramByKey = new Map(release.parameters.map((p) => [p.key, p]));
    const seenStepIds = new Set<string>();
    const seenUiParams = new Set<string>();
    for (const step of release.ui.steps) {
      if (seenStepIds.has(step.id)) defects.push(duplicate("ui step", `ui[${step.id}]`, step.id));
      seenStepIds.add(step.id);
      const seenGroupIds = new Set<string>();
      for (const group of step.groups) {
        const at = `ui[${step.id}].${group.id}`;
        if (seenGroupIds.has(group.id)) defects.push(duplicate("ui group", at, group.id));
        seenGroupIds.add(group.id);
        for (const key of group.params) {
          const param = paramByKey.get(key);
          if (param === undefined) {
            defects.push({
              code: "ui.param.unknown",
              where: at,
              message: `"${key}" is not a declared parameter`,
            });
            continue;
          }
          if (seenUiParams.has(key)) {
            defects.push({
              code: "ui.param.duplicate",
              where: at,
              message: `parameter "${key}" appears more than once in the ui spec`,
            });
          }
          seenUiParams.add(key);
          if (param.adjustability === "vendor") {
            defects.push({
              code: "ui.param.vendor",
              where: at,
              message: `"${key}" is vendor-only — it must never reach a tenant surface (I7)`,
            });
          }
        }
      }
    }
    for (const p of release.parameters) {
      if (p.adjustability !== "vendor" && !seenUiParams.has(p.key)) {
        defects.push({
          code: "ui.param.uncovered",
          where: `ui`,
          message: `writable parameter "${p.key}" is missing from the ui spec — it would be silently uneditable`,
        });
      }
    }
  }

  // --- Reference & function checks over every parsed slot ----------------------
  for (const slot of slots) {
    for (const fn of collectCalls(slot.ast)) {
      if (!isKnownFunction(fn)) {
        defects.push({
          code: "fn.unknown",
          where: slot.where,
          message: `"${fn}()" is not a whitelisted function`,
        });
      }
    }
    for (const ref of collectRefs(slot.ast)) {
      if (slot.openPrefixes.some((prefix) => ref.startsWith(prefix))) continue;
      if (!slot.known.has(ref)) {
        defects.push({
          code: "ref.unknown",
          where: slot.where,
          message: `reference "${ref}" will not be in scope here`,
        });
      }
    }
  }

  return defects;
}

/** Whether `name` is a param key, an option attr, or a derived key — the names
 *  a geometry repeat var must not shadow (matches the part-scope universe). */
function partHas(release: ProductModelRelease, name: string): boolean {
  if (release.parameters.some((p) => p.key === name)) return true;
  if (release.derivation.derived.some((d) => d.key === name)) return true;
  for (const set of release.optionSets ?? []) {
    for (const option of set.options) {
      if (Object.keys(option.attrs).some((attr) => `${set.key}.${attr}` === name)) return true;
    }
  }
  return false;
}

/** Throw on any defect — the form the publish flow and fixtures use. */
export function assertValidRelease(release: ProductModelRelease, catalog?: Catalog): void {
  const defects = validateRelease(release, catalog);
  if (defects.length > 0) throw new ReleaseValidationError(defects);
}
