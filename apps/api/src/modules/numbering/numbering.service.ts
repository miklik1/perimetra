/**
 * Document-number allocator (ADR 0109 / ADR-O1) — the generalized ADR 0079
 * gap-free per-org/series/year sequence. Like `OutboxService`, this is a
 * leaf infrastructure service that holds the `TransactionHost` directly and
 * writes on the AMBIENT transaction: `allocate()` MUST run inside the caller's
 * `@Transactional()` scope (the document-issue tx), so the increment commits or
 * rolls back WITH the document insert — a failed issue leaves no gap, and
 * concurrent issues serialize on the `(org, series, year)` PK row lock.
 *
 * The wall-clock `year` is chosen by the app-layer caller (never the engine —
 * I1 determinism), exactly as the quote allocator does.
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { type Db } from "@repo/db";
import { documentNumberSequence } from "@repo/db/schema/numbering";

import { type RequestScope } from "../../common/tenancy/request-scope.js";

@Injectable()
export class NumberingService {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  /**
   * Allocate the next number in the org's `(series, year)` series. Atomic
   * upsert-and-increment: the first allocation inserts `last_number = 1`, every
   * later one bumps under the row lock. Returns the assigned sequence value.
   */
  async allocate(scope: RequestScope, series: string, year: number): Promise<number> {
    const [row] = await this.txHost.tx
      .insert(documentNumberSequence)
      .values({ organizationId: scope.organizationId, series, year, lastNumber: 1 })
      .onConflictDoUpdate({
        target: [
          documentNumberSequence.organizationId,
          documentNumberSequence.series,
          documentNumberSequence.year,
        ],
        set: {
          lastNumber: sql`${documentNumberSequence.lastNumber} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ lastNumber: documentNumberSequence.lastNumber });
    return row!.lastNumber;
  }
}
