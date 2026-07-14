/**
 * Deviation-ledger service (ADR 0110 / ADR-O4, CAR-159) — the write-through
 * projection + the queryable recurrence report. The `record*` methods run
 * INSIDE the caller's `@Transactional()` scope (the source act's tx: a quote
 * issue, a margin override, an order exception), so a deviation row commits or
 * rolls back WITH the act that caused it. `rebuildQuoteOverrides` re-projects
 * the snapshot-derivable rows (the drift-repair guarantee). The ENGINE enforces
 * deviation bounds; this module only records + reports.
 */
import { Transactional } from "@nestjs-cls/transactional";
import { Injectable } from "@nestjs/common";

import { type DeviationLedgerRow } from "@repo/db/schema/ledger";
import { recurrenceReport } from "@repo/engine";
import { type Override, type Value } from "@repo/model";
import { type LedgerEntry, type LedgerPage, type ListLedgerQuery } from "@repo/validators/ledger";

import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { projectQuoteOverrides, type OverrideCarryingSnapshot } from "./deviation-projection.js";
import { LedgerRepository } from "./ledger.repository.js";

function toEntry(row: DeviationLedgerRow): LedgerEntry {
  return {
    id: row.id,
    quoteId: row.quoteId,
    orderId: row.orderId,
    source: row.source,
    kind: row.kind,
    target: row.target,
    value: row.value ?? null,
    reason: row.reason,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A `quote_override` ledger row → the `Override` the pure `recurrenceReport`
 *  groups on (it reads only scope/target/scopeRef/value/reason). */
function toOverride(row: DeviationLedgerRow): Override {
  return {
    id: row.id,
    scope: "quote",
    scopeRef: row.quoteId,
    target: row.target ?? "",
    value: (row.value ?? null) as Value,
    author: row.actorId ?? "",
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class LedgerService {
  constructor(private readonly ledger: LedgerRepository) {}

  /** Project a quote's frozen quote-scope overrides (called from quote issue,
   *  in that tx). A no-op for the common override-free quote. */
  async recordQuoteOverrides(
    scope: RequestScope,
    quoteId: string,
    snapshot: OverrideCarryingSnapshot,
  ): Promise<void> {
    await this.ledger.insertMany(scope, projectQuoteOverrides(quoteId, snapshot));
  }

  /** Record an admin margin-floor override alongside its audit row (quote issue tx). */
  async recordMarginOverride(
    scope: RequestScope,
    quoteId: string,
    marginAudit: { marginPct: number; floorPct: number; reason: string },
    actorId: string | null,
  ): Promise<void> {
    await this.ledger.insertMany(scope, [
      {
        quoteId,
        source: "margin_override",
        value: marginAudit,
        reason: marginAudit.reason,
        actorId,
      },
    ]);
  }

  /** Record a production-time order exception (order cancel-in-production, or the
   *  explicit exceptions endpoint), in the caller's tx. */
  async recordOrderException(
    scope: RequestScope,
    input: { quoteId: string; orderId: string; reason: string; target?: string | null },
    actorId: string | null,
  ): Promise<void> {
    await this.ledger.insertMany(scope, [
      {
        quoteId: input.quoteId,
        orderId: input.orderId,
        source: "order_exception",
        target: input.target ?? null,
        reason: input.reason,
        actorId,
      },
    ]);
  }

  /** The queryable ledger + the recurrence report over the org's quote-scope
   *  deviations (matching the `target` filter when given). */
  async query(scope: RequestScope, params: ListLedgerQuery): Promise<LedgerPage> {
    const rows = await this.ledger.list(scope, params);
    const items = rows.slice(0, params.limit);
    const nextCursor = rows.length > params.limit ? (items.at(-1)?.id ?? null) : null;

    const overrides = (await this.ledger.findQuoteOverrides(scope, params.target)).map(toOverride);
    return { items: items.map(toEntry), nextCursor, recurrence: recurrenceReport(overrides) };
  }

  /** Re-project the snapshot-derivable rows from the caller-supplied quote
   *  snapshots (QuotesService owns them). Atomic: clear then re-insert, so a
   *  drifted projection is repaired by construction. The authoritative
   *  `margin_override`/`order_exception` rows are left untouched. */
  @Transactional()
  async rebuildQuoteOverrides(
    scope: RequestScope,
    quotes: { quoteId: string; snapshot: unknown }[],
  ): Promise<number> {
    await this.ledger.deleteQuoteOverrides(scope);
    let count = 0;
    for (const q of quotes) {
      const rows = projectQuoteOverrides(q.quoteId, q.snapshot as OverrideCarryingSnapshot);
      await this.ledger.insertMany(scope, rows);
      count += rows.length;
    }
    return count;
  }
}
