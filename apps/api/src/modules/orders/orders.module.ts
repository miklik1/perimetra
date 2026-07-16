import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { LedgerModule } from "../ledger/ledger.module.js";
import { NumberingModule } from "../numbering/numbering.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { QuotesModule } from "../quotes/quotes.module.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersRepository } from "./orders.repository.js";
import { OrdersService } from "./orders.service.js";

/**
 * API half of the orders module (ADR 0109 / ADR-O1) — a thin reference entity
 * over the accepted quote. Imports `QuotesModule` (the quote-acceptance guard +
 * the re-homed production projection, cross-module via `QuotesService`, never a
 * schema join) and `NumberingModule` (the shared gap-free allocator). The event
 * handler lives in `OrdersWorkerModule` — the HTTP deployable never consumes
 * queues (ADR 0031). `AuditService` arrives via the `@Global()` AuditModule.
 */
@Module({
  imports: [AuthModule, OutboxModule, QuotesModule, NumberingModule, LedgerModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
  // Exported for the invoices module's issue seam (`assertIssuableForInvoice`,
  // ADR 0112) — a cross-module service read, never a schema join (ADR 0032).
  exports: [OrdersService],
})
export class OrdersModule {}
