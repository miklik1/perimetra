/**
 * Override — the cascade's write record (CORE_SPEC §4, I8). No layer's data is
 * ever edited by a higher layer; an override is a NEW record with provenance,
 * and removing it restores the layer below. The exception ledger is simply the
 * queryable set of all quote-scope overrides — deviations become data, the
 * vendor's promotion queue (ETO→CTO).
 *
 * Target grammar (stable addresses, I9):
 *   "param:<key>"               — a parameter value. tenant/customer scope
 *                                 patches the DEFAULT (stays inside `domain`);
 *                                 quote scope is a DEVIATION, validated against
 *                                 the parameter's `deviation` spec instead.
 *   "price:<code>"              — a price-table entry (component code, or
 *                                 manufacturing_rate / manufacturing_multiplier
 *                                 / installation).
 *   "artifact:<partPath>.<field>" — quote-only patch of an emitted part
 *                                 (field: quantity | lengthMm | pricePerUnit |
 *                                 totalPrice); always flagged on the result.
 */
import type { Value } from "./expr.js";

/** Cascade layers 3–5 (release + catalog are vendor data, not override scopes). */
export type OverrideScope = "tenant" | "customer" | "quote";

/** The explicit price consequence sales chooses for a quantity patch:
 *  keep the derived line total, or reprice quantity × unit (margin floor
 *  guards consume this at the app layer). */
export type PricingResolution = "keep_price" | "reprice";

export interface Override {
  id: string;
  scope: OverrideScope;
  /** tenantId / customerAgreementId / quoteId — opaque to the engine. */
  scopeRef: string;
  target: string;
  value: Value;
  /** Provenance (I8). `reason` is REQUIRED for deviation.mode="warn" targets. */
  author: string;
  reason?: string;
  createdAt: string;
  /** Required when target is "artifact:….quantity" (price-bearing patch). */
  pricingResolution?: PricingResolution;
}

/** Fields of an emitted part an artifact override may patch (CORE_SPEC §6). */
export const ARTIFACT_FIELDS = ["quantity", "lengthMm", "pricePerUnit", "totalPrice"] as const;
export type ArtifactField = (typeof ARTIFACT_FIELDS)[number];

export type OverrideTarget =
  | { kind: "param"; key: string }
  | { kind: "price"; code: string }
  | { kind: "artifact"; path: string; field: ArtifactField };

/** Parse a target address; undefined means malformed (a config-time Issue for
 *  the engine — overrides are tenant-side-authored data, never a throw). */
export function parseOverrideTarget(target: string): OverrideTarget | undefined {
  if (target.startsWith("param:")) {
    const key = target.slice("param:".length);
    return key.length > 0 && !key.includes(".") ? { kind: "param", key } : undefined;
  }
  if (target.startsWith("price:")) {
    const code = target.slice("price:".length);
    return code.length > 0 ? { kind: "price", code } : undefined;
  }
  if (target.startsWith("artifact:")) {
    // The field is the segment after the LAST dot; part paths themselves
    // contain dots ("frame.lprofile") and brackets ("rail.set[standard]").
    const address = target.slice("artifact:".length);
    const cut = address.lastIndexOf(".");
    if (cut <= 0) return undefined;
    const path = address.slice(0, cut);
    const field = address.slice(cut + 1);
    if (!(ARTIFACT_FIELDS as readonly string[]).includes(field)) return undefined;
    return { kind: "artifact", path, field: field as ArtifactField };
  }
  return undefined;
}
