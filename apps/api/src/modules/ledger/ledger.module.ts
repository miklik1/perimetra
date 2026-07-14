import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { LedgerController } from "./ledger.controller.js";
import { LedgerRepository } from "./ledger.repository.js";
import { LedgerService } from "./ledger.service.js";

/**
 * Deviation-ledger module (ADR 0110 / ADR-O4, CAR-159) — a REBUILDABLE
 * projection. Exports `LedgerService` so the source-act modules (quotes at
 * issue/margin-override, orders at exception) write deviation rows in their own
 * tx — a strictly one-way dependency (quotes/orders → ledger; the ledger never
 * imports them), which is why the snapshot-driven rebuild is orchestrated by
 * `QuotesService`, not here. No outbox/worker: a projection is queried on
 * demand, not broadcast.
 */
@Module({
  imports: [AuthModule],
  controllers: [LedgerController],
  providers: [LedgerService, LedgerRepository],
  exports: [LedgerService],
})
export class LedgerModule {}
