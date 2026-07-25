import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { CustomersModule } from "../customers/customers.module.js";
import { InvoicesModule } from "../invoices/invoices.module.js";
import { OrdersModule } from "../orders/orders.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { QuotesModule } from "../quotes/quotes.module.js";
import { DeliveriesController } from "./deliveries.controller.js";
import { DeliveriesRepository } from "./deliveries.repository.js";
import { DeliveriesService } from "./deliveries.service.js";

/**
 * API half of the deliveries module (ADR 0129, Wave A2).
 *
 * WHY A MODULE OF ITS OWN rather than routes on `QuotesController` /
 * `InvoicesController`: the guards ("has a recipient", "not anonymized", "not
 * superseded", "not already in flight") are DELIVERY concerns, identical for
 * both document classes. One module = ONE implementation for two document
 * types; splitting them across two controllers duplicates the guards and
 * guarantees drift. It also keeps the dependency direction clean and acyclic —
 * deliveries → {quotes, invoices, orders, customers, outbox, auth}, and none of
 * those imports deliveries.
 *
 * Every document fact is read through the OWNING service (cross-module, never a
 * schema join — ADR 0032); ZERO new methods were needed on quotes/invoices/
 * orders, and the one new seam is `CustomersService.getDeliveryRecipient`.
 * `AuditService` arrives via the `@Global()` AuditModule.
 *
 * The event handler lives in `DeliveriesWorkerModule` — the HTTP deployable
 * never consumes queues (ADR 0031).
 */
@Module({
  imports: [AuthModule, OutboxModule, QuotesModule, InvoicesModule, OrdersModule, CustomersModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService, DeliveriesRepository],
})
export class DeliveriesModule {}
