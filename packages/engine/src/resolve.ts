/**
 * Catalog resolution (CORE_SPEC §2) — the one mechanism mapping a recipe's
 * semantic request {role, section?, material?} onto a purchasable Component.
 *
 * Outcomes follow the error taxonomy:
 *   - zero matches  → a CONFIG-time Issue carrying the missing triple (I5);
 *                     it doubles as the vendor's "what to add" worklist.
 *   - >1 match      → an AUTHOR-time throw — the catalog data is ambiguous,
 *                     which no user input should be able to cause.
 */
import type { Catalog, Component } from "@repo/model";

import type { Issue } from "./types.js";

/** A fully evaluated resolution request (section/material exprs already run). */
export interface ResolutionRequest {
  role: string;
  section?: string;
  material?: string;
}

export type ResolutionOutcome = { ok: true; component: Component } | { ok: false; issue: Issue };

/** Catalog data defect: a request matched by more than one component. */
export class CatalogAmbiguityError extends Error {
  constructor(request: ResolutionRequest, matches: Component[]) {
    super(
      `Ambiguous catalog resolution for ${describe(request)}: ` +
        matches.map((c) => `"${c.code}"`).join(", "),
    );
    this.name = "CatalogAmbiguityError";
  }
}

function describe(request: ResolutionRequest): string {
  const parts = [`role=${request.role}`];
  if (request.section !== undefined) parts.push(`section=${request.section}`);
  if (request.material !== undefined) parts.push(`material=${request.material}`);
  return `{${parts.join(", ")}}`;
}

/**
 * A component matches when it carries the role and equals the request on every
 * axis the request constrains. An axis the request leaves open must be absent
 * on the component too — a material-specific component never satisfies a
 * material-agnostic request (that would be a silent guess, I5).
 */
function matches(component: Component, request: ResolutionRequest): boolean {
  if (!component.roles.includes(request.role)) return false;
  if ((request.section ?? undefined) !== component.section) return false;
  if ((request.material ?? undefined) !== component.material) return false;
  return true;
}

export function resolveComponent(catalog: Catalog, request: ResolutionRequest): ResolutionOutcome {
  const found = catalog.components.filter((c) => matches(c, request));
  if (found.length > 1) throw new CatalogAmbiguityError(request, found);
  if (found.length === 1) return { ok: true, component: found[0]! };

  const params: Issue["params"] = { role: request.role };
  if (request.section !== undefined) params.section = request.section;
  if (request.material !== undefined) params.material = request.material;
  return {
    ok: false,
    issue: {
      key: "engine.catalog.unresolved",
      severity: "error",
      scope: "instance",
      params,
    },
  };
}
