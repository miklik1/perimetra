/**
 * Constraint evaluation (CORE_SPEC §3). The evaluator is a swappable module
 * behind a narrow interface: today a forward checker walks declarative records;
 * if option-interaction complexity ever crosses the research's solver triggers,
 * a CSP evaluator replaces it and every authored model comes along unchanged.
 * The schema is the commitment; this is an implementation detail.
 */
import { evalBoolean, type Scope } from "@repo/model";
import type { ProductModelRelease } from "@repo/model";

import type { Issue } from "./types.js";

export interface ConstraintEvaluator {
  evaluate(release: ProductModelRelease, scope: Scope): Issue[];
  /** Evaluate one connected end's connection-scope constraints against the
   *  paired site scope (`self.*` = this release's values, `other.*` = the
   *  opposite end's — built by deriveSite). The caller adds the connection
   *  addressing to the returned issues' params. */
  evaluateConnection(release: ProductModelRelease, pairScope: Scope): Issue[];
}

/** The forward checker: walk the declarative records, evaluate, raise an Issue
 *  of the declared severity on a false result. A `self.*`/`other.*` ref missing
 *  from the pair scope throws — declaring port kinds compatible is the vendor's
 *  contract that the refs exist (CORE_SPEC §5; vendor-only authoring). */
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

  evaluateConnection(release, pairScope) {
    const issues: Issue[] = [];
    for (const c of release.constraints) {
      if (c.scope !== "connection") continue;
      const ok = evalBoolean(c.expr, pairScope);
      if (!ok) {
        issues.push({ key: c.key, severity: c.severity, scope: c.scope });
      }
    }
    return issues;
  },
};
