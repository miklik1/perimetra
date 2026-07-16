import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { CustomersModule } from "../customers/customers.module.js";
import { LegalProfilesModule } from "../legal-profiles/legal-profiles.module.js";
import { NumberingModule } from "../numbering/numbering.module.js";
import { OrdersModule } from "../orders/orders.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { QuotesModule } from "../quotes/quotes.module.js";
import { InvoicesController } from "./invoices.controller.js";
import { InvoicesRepository } from "./invoices.repository.js";
import { InvoicesService } from "./invoices.service.js";

/**
 * API half of the invoices module (ADR 0112, ADR-O2). Issue reads its commercial
 * basis + supply-time identity through the OWNING services (cross-module, never a
 * schema join — ADR 0032): `OrdersModule` (order → quote guard), `QuotesModule`
 * (the frozen per-rate `TaxBreakdown`), `LegalProfilesModule` (supplier + IBAN),
 * `CustomersModule` (live buyer + anonymized guard), `NumberingModule` (the
 * shared gap-free `"invoice"` allocator). The event handler lives in
 * `InvoicesWorkerModule` — the HTTP deployable never consumes queues (ADR 0031).
 * `AuditService` arrives via the `@Global()` AuditModule.
 */
@Module({
  imports: [
    AuthModule,
    OutboxModule,
    OrdersModule,
    QuotesModule,
    LegalProfilesModule,
    CustomersModule,
    NumberingModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicesRepository],
})
export class InvoicesModule {}
