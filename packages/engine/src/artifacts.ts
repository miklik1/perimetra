/**
 * Artifact-level overrides (CORE_SPEC §6) — the deep half of the mm-exception
 * requirement: a specific emitted quantity, cut length, or price patched at
 * quote scope ("make that one cut 1942"). The salesperson is never blocked;
 * the workshop always sees what deviated (every patch lands as a deviation
 * flag on the part AND a warn Issue); the system is never silently wrong
 * (a patch that cannot apply is an error Issue, not a skip — I5).
 *
 * Applied to PRICED parts: a quantity patch resolves its price consequence via
 * the override's explicit `pricingResolution` ("keep_price" pins the derived
 * line total, "reprice" recomputes quantity × unit); pricePerUnit/totalPrice
 * patches ARE the pricing resolution; lengthMm is geometry-only.
 *
 * Cost-of-goods (ADR 0059) is physical, not commercial: on a quantity patch a
 * RATE-priced line (has `costPerUnit`) rescales `totalCost` (more units cost
 * more, whatever the price does — so keep_price erodes margin and the floor
 * guard sees it); a fixed-total cost line (no `costPerUnit`) keeps its total,
 * exactly as keep_price pins a fixed-total price. A price patch
 * (pricePerUnit/totalPrice) never touches cost. The cost branches are inert when
 * no cost table was supplied (parts then carry no `costPerUnit`/`totalCost`).
 */
import { parseOverrideTarget } from "@repo/model";
import type { Override } from "@repo/model";

import type { Issue, Part, PartDeviation } from "./types.js";

export interface ArtifactOutcome {
  parts: Part[];
  issues: Issue[];
}

export function applyArtifactOverrides(parts: Part[], overrides: Override[]): ArtifactOutcome {
  if (overrides.length === 0) return { parts, issues: [] };

  const issues: Issue[] = [];
  const patched = new Map(parts.map((p) => [p.path, { ...p }]));

  for (const override of overrides) {
    // Shape was validated by the cascade; the parse cannot fail here.
    const target = parseOverrideTarget(override.target);
    if (target === undefined || target.kind !== "artifact") continue;
    const part = patched.get(target.path);
    if (part === undefined) {
      // A stale address (the part is no longer emitted under this config) is
      // an error, not a skip — the deviation the salesperson recorded would
      // otherwise silently not exist (I5/I9).
      issues.push({
        key: "engine.override.artifact_missing",
        severity: "error",
        scope: "instance",
        params: { id: override.id, path: target.path },
      });
      continue;
    }

    const value = override.value as number;
    const deviation: PartDeviation = {
      field: target.field,
      value,
      overrideId: override.id,
      ...(part[target.field] !== undefined && { original: part[target.field] }),
      ...(override.reason !== undefined && { reason: override.reason }),
    };

    switch (target.field) {
      case "quantity":
        part.quantity = value;
        // Cost always follows the physical quantity (a rate-priced line only —
        // a fixed-total cost line has no unit cost to scale from).
        if (part.costPerUnit !== undefined) {
          part.totalCost = value * part.costPerUnit;
        }
        if (override.pricingResolution === "reprice") {
          if (part.pricePerUnit === undefined) {
            // A fixed-total line has no unit price to reprice from.
            issues.push({
              key: "engine.override.cannot_reprice",
              severity: "error",
              scope: "instance",
              params: { id: override.id, path: part.path },
            });
            continue;
          }
          part.totalPrice = value * part.pricePerUnit;
        }
        break;
      case "lengthMm":
        part.lengthMm = value;
        break;
      case "pricePerUnit":
        part.pricePerUnit = value;
        part.totalPrice = part.quantity * value;
        break;
      case "totalPrice":
        part.totalPrice = value;
        break;
    }

    part.deviations = [...(part.deviations ?? []), deviation];
    issues.push({
      key: "engine.deviation.artifact",
      severity: "warn",
      scope: "instance",
      params: {
        path: part.path,
        field: target.field,
        value,
        ...(override.reason !== undefined && { reason: override.reason }),
      },
    });
  }

  return { parts: parts.map((p) => patched.get(p.path)!), issues };
}
