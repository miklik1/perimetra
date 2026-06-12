/**
 * The exception ledger (CORE_SPEC §4) — deviations become product
 * intelligence. The ledger IS the queryable set of all quote-scope overrides;
 * the recurrence report groups it by target so recurring deviations surface as
 * the vendor's authoring queue (promotion into a real option in the next
 * release — the validated ETO→CTO flow). Promotion itself is a human decision
 * on a cadence, never automatic: this module reports, it does not act.
 *
 * Pure queries over stored Override rows — storage, cadence, and the vendor UI
 * live upstream.
 */
import type { Override, Value } from "@repo/model";

/** The ledger: every this-order-only exception, with full provenance (I8). */
export function exceptionLedger(overrides: Override[]): Override[] {
  return overrides.filter((o) => o.scope === "quote");
}

export interface RecurrenceGroup {
  target: string;
  /** Total ledger entries hitting this target. */
  occurrences: number;
  /** Distinct quotes — "same deviation on five quotes" is the promotion signal. */
  distinctQuotes: number;
  /** Values seen, in encounter order — the spread an authored option must cover. */
  values: Value[];
  /** The recorded "why"s — the domain knowledge the vendor is promoting. */
  reasons: string[];
}

/**
 * Group the ledger by exact target and report every target deviating across at
 * least `minOccurrences` entries, most recurrent first. (v1 matches targets
 * exactly; "± similar value" clustering is a report refinement, not a schema
 * change.)
 */
export function recurrenceReport(overrides: Override[], minOccurrences = 2): RecurrenceGroup[] {
  const groups = new Map<string, { quotes: Set<string>; values: Value[]; reasons: string[] }>();

  for (const entry of exceptionLedger(overrides)) {
    let group = groups.get(entry.target);
    if (group === undefined) {
      group = { quotes: new Set(), values: [], reasons: [] };
      groups.set(entry.target, group);
    }
    group.quotes.add(entry.scopeRef);
    group.values.push(entry.value);
    if (entry.reason !== undefined && entry.reason.trim() !== "") group.reasons.push(entry.reason);
  }

  return [...groups.entries()]
    .map(([target, g]) => ({
      target,
      occurrences: g.values.length,
      distinctQuotes: g.quotes.size,
      values: g.values,
      reasons: g.reasons,
    }))
    .filter((g) => g.occurrences >= minOccurrences)
    .sort((a, b) => b.occurrences - a.occurrences || a.target.localeCompare(b.target));
}
