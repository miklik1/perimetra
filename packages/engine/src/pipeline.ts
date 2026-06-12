/**
 * The derivation pipeline (CORE_SPEC §5) — the one compute path:
 *
 *   resolve cascade (overrides + input gate, I7/I8) → validate constraints
 *     → derive assembly graph (catalog resolution) → emit → apply artifact
 *     overrides (deviation flags) → money boundary (I10)
 *
 * The catalog and price table enter as versioned data arguments — never
 * ambient state — and the result carries the stamps (release id + catalog +
 * price table versions + the exact override set applied) a quote needs for
 * eternal reproducibility (I3).
 *
 * Error taxonomy (ADR 0047): user-shaped problems (input gate, overrides,
 * option selection, constraint failures, catalog resolution gaps) surface as
 * typed Issues on an invalid result; author-shaped problems (bad expressions,
 * ambiguous catalog data, unit mismatches) throw.
 *
 * Determinism (I1): given the same (release, input, prices, catalog,
 * overrides) the result is byte-identical — the whole path is pure.
 */
import type { Catalog, ProductModelRelease, Scope } from "@repo/model";

import { applyArtifactOverrides } from "./artifacts";
import { resolveCascade, type CascadeLayers } from "./cascade";
import { forwardChecker, type ConstraintEvaluator } from "./constraints";
import { derive, evaluateAnchors } from "./derive";
import { priceParts, sumByCategory, toMoneyTotals } from "./emit";
import { buildScope } from "./scope";
import { ConfigError, type ConfigInput, type DerivationResult, type Issue } from "./types";
import type { PriceTable, Stamps } from "./types";

export interface DeriveOptions {
  /** Swap the constraint evaluator (defaults to the forward checker). */
  constraintEvaluator?: ConstraintEvaluator;
  /** Cascade layers 3–5 (CORE_SPEC §4); omitted layers are empty. */
  overrides?: CascadeLayers;
}

/** deriveInstance plus the full post-derivation evaluation scope (params +
 *  option attrs + price.* + derived) — what the site graph pairs into the
 *  `self.*`/`other.*` connection-constraint scopes (CORE_SPEC §5). `scope` is
 *  absent when the result is invalid. */
export interface DetailedDerivation {
  result: DerivationResult;
  scope?: Scope;
}

/** An invalid configuration never emits a BOM/price — typed issues only (I5). */
function invalid(issues: Issue[], stamps: Stamps): DerivationResult {
  const totals = { material: 0, accessory: 0, manufacturing: 0, installation: 0, total: 0 };
  return {
    isValid: false,
    derived: {},
    parts: [],
    totals,
    money: toMoneyTotals(totals),
    issues,
    stamps,
  };
}

export function deriveInstanceDetailed(
  release: ProductModelRelease,
  input: ConfigInput,
  prices: PriceTable,
  catalog: Catalog,
  options: DeriveOptions = {},
): DetailedDerivation {
  const evaluator = options.constraintEvaluator ?? forwardChecker;

  const cascade = resolveCascade(release, input, prices, options.overrides ?? {});
  const stamps: Stamps = {
    releaseId: release.id,
    catalogVersion: catalog.version,
    priceTableVersion: prices.version,
    overrideIds: cascade.appliedOverrideIds,
  };

  if (cascade.issues.some((i) => i.severity === "error")) {
    return { result: invalid(cascade.issues, stamps) };
  }

  let scope;
  try {
    scope = buildScope(release, cascade.effectiveInput, cascade.effectivePrices);
  } catch (error) {
    if (error instanceof ConfigError) {
      return { result: invalid([...cascade.issues, error.issue], stamps) };
    }
    throw error;
  }

  const issues = [...cascade.issues, ...evaluator.evaluate(release, scope)];

  // A failed constraint of severity "error" stops before derivation — we never
  // emit a BOM/price for an invalid configuration (I5).
  if (issues.some((i) => i.severity === "error")) {
    return { result: invalid(issues, stamps) };
  }

  const graph = derive(release, scope, catalog);
  if (graph.issues.length > 0) {
    // Catalog resolution gaps — the full missing-triple worklist, no partial BOM.
    return { result: invalid([...issues, ...graph.issues], stamps) };
  }

  const priced = priceParts(graph.parts, cascade.effectivePrices);
  const artifacts = applyArtifactOverrides(priced, cascade.artifactOverrides);
  issues.push(...artifacts.issues);
  if (artifacts.issues.some((i) => i.severity === "error")) {
    return { result: invalid(issues, stamps) };
  }

  const totals = sumByCategory(artifacts.parts);
  const fullScope: Scope = { ...scope, ...graph.derived };
  const anchors = evaluateAnchors(release, fullScope);

  return {
    result: {
      isValid: true,
      derived: graph.derived,
      parts: artifacts.parts,
      ...(anchors !== undefined && { anchors }),
      totals,
      money: toMoneyTotals(totals),
      issues,
      stamps,
    },
    scope: fullScope,
  };
}

export function deriveInstance(
  release: ProductModelRelease,
  input: ConfigInput,
  prices: PriceTable,
  catalog: Catalog,
  options: DeriveOptions = {},
): DerivationResult {
  return deriveInstanceDetailed(release, input, prices, catalog, options).result;
}
