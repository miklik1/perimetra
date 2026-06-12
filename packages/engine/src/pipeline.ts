/**
 * The derivation pipeline (CORE_SPEC §5) — the one compute path:
 *
 *   gate input (I7) → resolve cascade → validate constraints
 *     → derive assembly graph (catalog resolution) → emit
 *
 * The catalog enters as a versioned data argument exactly like the price
 * table — never ambient state — and the result carries the stamps (release id
 * + catalog version) a quote needs for eternal reproducibility (I3).
 *
 * Error taxonomy (ADR 0047): user-shaped problems (input gate, option
 * selection, constraint failures, catalog resolution gaps) surface as typed
 * Issues on an invalid result; author-shaped problems (bad expressions,
 * ambiguous catalog data, unit mismatches) throw.
 *
 * Determinism (I1): given the same (release, input, prices, catalog) the
 * result is byte-identical — the whole path is pure.
 */
import type { Catalog, ProductModelRelease } from "@repo/model";

import { forwardChecker, type ConstraintEvaluator } from "./constraints";
import { derive } from "./derive";
import { priceParts, sumByCategory } from "./emit";
import { buildScope, gateInput } from "./scope";
import { ConfigError, type ConfigInput, type DerivationResult, type Issue } from "./types";
import type { PriceTable, Stamps } from "./types";

export interface DeriveOptions {
  /** Swap the constraint evaluator (defaults to the forward checker). */
  constraintEvaluator?: ConstraintEvaluator;
}

/** An invalid configuration never emits a BOM/price — typed issues only (I5). */
function invalid(issues: Issue[], stamps: Stamps): DerivationResult {
  return {
    isValid: false,
    derived: {},
    parts: [],
    totals: { material: 0, accessory: 0, manufacturing: 0, installation: 0, total: 0 },
    issues,
    stamps,
  };
}

export function deriveInstance(
  release: ProductModelRelease,
  input: ConfigInput,
  prices: PriceTable,
  catalog: Catalog,
  options: DeriveOptions = {},
): DerivationResult {
  const evaluator = options.constraintEvaluator ?? forwardChecker;
  const stamps: Stamps = { releaseId: release.id, catalogVersion: catalog.version };

  const gateIssues = gateInput(release, input);
  if (gateIssues.some((i) => i.severity === "error")) {
    return invalid(gateIssues, stamps);
  }

  let scope;
  try {
    scope = buildScope(release, input, prices);
  } catch (error) {
    if (error instanceof ConfigError) return invalid([...gateIssues, error.issue], stamps);
    throw error;
  }

  const issues = [...gateIssues, ...evaluator.evaluate(release, scope)];

  // A failed constraint of severity "error" stops before derivation — we never
  // emit a BOM/price for an invalid configuration (I5).
  if (issues.some((i) => i.severity === "error")) {
    return invalid(issues, stamps);
  }

  const graph = derive(release, scope, catalog);
  if (graph.issues.length > 0) {
    // Catalog resolution gaps — the full missing-triple worklist, no partial BOM.
    return invalid([...issues, ...graph.issues], stamps);
  }

  const parts = priceParts(graph.parts, prices);
  const totals = sumByCategory(parts);

  return {
    isValid: true,
    derived: graph.derived,
    parts,
    totals,
    issues,
    stamps,
  };
}
