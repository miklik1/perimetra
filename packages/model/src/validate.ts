/**
 * validateRelease — the publish gate (CORE_SPEC §3, I2/I9): a release with
 * defects cannot be published, and the fixtures harness runs the same gate so
 * authoring errors die at test time, BEFORE a model ships. These are
 * AUTHOR-time errors — vendor-shaped, so they throw/report as defects, never
 * as user-facing Issues (the engine's config-time taxonomy).
 *
 * Checks:
 *   - every expression parses and calls only whitelisted functions
 *   - key uniqueness: parameters, derived, constraints, option sets
 *   - part paths unique (I9 — stable addressing dies on duplicates)
 *   - every expr reference resolves against what its evaluation scope will
 *     actually contain (params, earlier derived, option attrs, price.*)
 *   - against a catalog: every resolve.role exists, and literal
 *     section/material requests name real catalog codes
 */
import type { Catalog } from "./catalog";
import { collectCalls, collectRefs, ExprError, isKnownFunction, parse, type Ast } from "./expr";
import type { ProductModelRelease } from "./schema";

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
  /** Names this slot's evaluation scope will contain (besides price.*). */
  known: ReadonlySet<string>;
}

const PRICE_PREFIX = "price.";

export function validateRelease(release: ProductModelRelease, catalog?: Catalog): ReleaseDefect[] {
  const defects: ReleaseDefect[] = [];
  const slots: Slot[] = [];

  const parseInto = (source: string, where: string, known: ReadonlySet<string>): void => {
    try {
      slots.push({ where, ast: parse(source), known });
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

  // --- Name universes ---------------------------------------------------------
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

  // Option attrs are injected as `<set.key>.<attr>`; the known set is the union
  // across the set's options (an attr missing on the selected option is a
  // runtime absence, which referencing surfaces as an I5 error).
  const optionAttrKeys = new Set<string>();
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
    for (const option of set.options) {
      for (const attr of Object.keys(option.attrs)) optionAttrKeys.add(`${set.key}.${attr}`);
    }
  }

  // --- Parameters: defaults see price.* + EARLIER params only (buildScope order)
  const earlier = new Set<string>();
  for (const p of release.parameters) {
    if (p.default !== undefined && p.defaultExpr !== undefined) {
      defects.push({
        code: "default.ambiguous",
        where: `parameters[${p.key}]`,
        message: "default and defaultExpr are mutually exclusive",
      });
    }
    if (p.defaultExpr !== undefined) {
      parseInto(p.defaultExpr, `parameters[${p.key}].defaultExpr`, new Set(earlier));
    }
    earlier.add(p.key);
    const uiKnown = new Set([...paramKeys, ...optionAttrKeys]);
    if (p.relevance !== undefined)
      parseInto(p.relevance, `parameters[${p.key}].relevance`, uiKnown);
    if (p.deviation?.bounds) {
      parseInto(p.deviation.bounds.min, `parameters[${p.key}].deviation.min`, uiKnown);
      parseInto(p.deviation.bounds.max, `parameters[${p.key}].deviation.max`, uiKnown);
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

  // --- Constraints: evaluated BEFORE derivation — derived keys are not in scope
  const constraintKnown = new Set([...paramKeys, ...optionAttrKeys]);
  const seenConstraintKeys = new Set<string>();
  for (const c of release.constraints) {
    if (seenConstraintKeys.has(c.key)) {
      defects.push(duplicate("constraint", `constraints[${c.key}]`, c.key));
    }
    seenConstraintKeys.add(c.key);
    parseInto(c.expr, `constraints[${c.key}]`, constraintKnown);
  }

  // --- Derived: each sees params, option attrs, and EARLIER derived keys
  const derivedSoFar = new Set<string>();
  for (const d of release.derivation.derived) {
    if (derivedSoFar.has(d.key) || paramKeys.has(d.key)) {
      defects.push(duplicate("derived key", `derived[${d.key}]`, d.key));
    }
    parseInto(d.expr, `derived[${d.key}]`, new Set([...constraintKnown, ...derivedSoFar]));
    derivedSoFar.add(d.key);
  }

  // --- Parts: full scope (params + option attrs + all derived); paths unique (I9)
  const partKnown = new Set([...constraintKnown, ...derivedSoFar]);
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

    if (rule.when !== undefined) parseInto(rule.when, `${at}.when`, partKnown);
    if (rule.resolve.section !== undefined) {
      parseInto(rule.resolve.section, `${at}.resolve.section`, partKnown);
    }
    if (rule.resolve.material !== undefined) {
      parseInto(rule.resolve.material, `${at}.resolve.material`, partKnown);
    }
    parseInto(rule.bom.quantity, `${at}.bom.quantity`, partKnown);
    if (rule.bom.lengthMm !== undefined)
      parseInto(rule.bom.lengthMm, `${at}.bom.lengthMm`, partKnown);
    if (rule.bom.pricePerUnit !== undefined) {
      parseInto(rule.bom.pricePerUnit, `${at}.bom.pricePerUnit`, partKnown);
    }
    if (rule.bom.totalPrice !== undefined) {
      parseInto(rule.bom.totalPrice, `${at}.bom.totalPrice`, partKnown);
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
      if (ref.startsWith(PRICE_PREFIX)) continue; // the price layer is open-keyed
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

/** Throw on any defect — the form the publish flow and fixtures use. */
export function assertValidRelease(release: ProductModelRelease, catalog?: Catalog): void {
  const defects = validateRelease(release, catalog);
  if (defects.length > 0) throw new ReleaseValidationError(defects);
}
