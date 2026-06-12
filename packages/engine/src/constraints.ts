/**
 * Constraint evaluation (CORE_SPEC §3). The evaluator is a swappable module
 * behind a narrow interface: today a forward checker walks declarative records;
 * if option-interaction complexity ever crosses the research's solver triggers,
 * a CSP evaluator replaces it and every authored model comes along unchanged.
 * The schema is the commitment; this is an implementation detail.
 */
import { evalBoolean, type Scope } from "@repo/model";
import type { ProductModelRelease } from "@repo/model";

import type { Issue } from "./types";

export interface ConstraintEvaluator {
  evaluate(release: ProductModelRelease, scope: Scope): Issue[];
}

/** Slice 1: evaluate each instance-scope constraint's expression; a false
 *  result raises an Issue of the declared severity. Connection-scope constraints
 *  (inter-instance) are skipped until the site graph lands (§5 / step 4). */
export const forwardChecker: ConstraintEvaluator = {
  evaluate(release, scope) {
    const issues: Issue[] = [];
    for (const c of release.constraints) {
      if (c.scope !== "instance") continue;
      const ok = evalBoolean(c.expr, scope);
      if (!ok) {
        issues.push({ key: c.key, severity: c.severity, scope: c.scope });
      }
    }
    return issues;
  },
};
