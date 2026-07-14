/**
 * Pure projection (ADR 0110 / ADR-O4, CAR-159): a quote's frozen snapshot →
 * the `quote_override` ledger rows. Every quote-scope override across the
 * roster becomes a row; the snapshot stays the only truth, so this projection
 * is fully rebuildable by re-running it. No I/O — the caller (LedgerService)
 * stamps the org + persists.
 */
import { parseOverrideTarget, type Override } from "@repo/model";

import { type LedgerRowInput } from "./ledger.repository.js";

/** The narrow slice of a `QuoteSnapshot` this projection reads. */
export interface OverrideCarryingSnapshot {
  inputs: Record<string, { overrides?: { quote?: Override[] } }>;
}

export function projectQuoteOverrides(
  quoteId: string,
  snapshot: OverrideCarryingSnapshot,
): LedgerRowInput[] {
  const rows: LedgerRowInput[] = [];
  for (const seed of Object.values(snapshot.inputs)) {
    for (const o of seed.overrides?.quote ?? []) {
      rows.push({
        quoteId,
        source: "quote_override",
        kind: parseOverrideTarget(o.target)?.kind ?? null,
        target: o.target,
        value: o.value,
        reason: o.reason ?? "",
      });
    }
  }
  return rows;
}
