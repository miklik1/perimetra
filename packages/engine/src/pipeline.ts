/**
 * The derivation pipeline (CORE_SPEC §5) — the one compute path:
 *
 *   resolve cascade → validate constraints → derive assembly graph → emit
 *
 * Slice 1 runs it for a single instance (the degenerate site, I11). Site
 * composition (sharing/ownership, connection constraints) wraps this per
 * instance in step 4 without changing the per-instance shape.
 *
 * Determinism (I1): given the same (release, input, prices) the result is
 * byte-identical — the whole path is pure.
 */
import type { ProductModelRelease } from "@repo/model";

import { forwardChecker, type ConstraintEvaluator } from "./constraints";
import { derive } from "./derive";
import { priceParts, sumByCategory } from "./emit";
import { buildScope } from "./scope";
import type { ConfigInput, DerivationResult, PriceTable } from "./types";

export interface DeriveOptions {
  /** Swap the constraint evaluator (defaults to the forward checker). */
  constraintEvaluator?: ConstraintEvaluator;
}

export function deriveInstance(
  release: ProductModelRelease,
  input: ConfigInput,
  prices: PriceTable,
  options: DeriveOptions = {},
): DerivationResult {
  const evaluator = options.constraintEvaluator ?? forwardChecker;

  const scope = buildScope(release, input, prices);
  const issues = evaluator.evaluate(release, scope);
  const hasError = issues.some((i) => i.severity === "error");

  // A failed constraint of severity "error" stops before derivation — we never
  // emit a BOM/price for an invalid configuration (I5).
  if (hasError) {
    return {
      isValid: false,
      derived: {},
      parts: [],
      totals: { material: 0, accessory: 0, manufacturing: 0, installation: 0, total: 0 },
      issues,
    };
  }

  const graph = derive(release, scope);
  const parts = priceParts(graph.parts, prices);
  const totals = sumByCategory(parts);

  return {
    isValid: true,
    derived: graph.derived,
    parts,
    totals,
    issues,
  };
}
