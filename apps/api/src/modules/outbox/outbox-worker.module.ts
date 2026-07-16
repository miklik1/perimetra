import { Module } from "@nestjs/common";

import { InvoicesWorkerModule } from "../invoices/invoices-worker.module.js";
import { InvoicesEventsHandler } from "../invoices/invoices.events.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { DOMAIN_EVENT_HANDLERS, type DomainEventHandler } from "../jobs/jobs.tokens.js";
import { OrdersWorkerModule } from "../orders/orders-worker.module.js";
import { OrdersEventsHandler } from "../orders/orders.events.js";
import { ProjectsWorkerModule } from "../projects/projects-worker.module.js";
import { ProjectsEventsHandler } from "../projects/projects.events.js";
// @gen:worker-module-imports — `pnpm gen module` injects domain worker module imports here.
import { EventsProcessor } from "./events.processor.js";
import { MaintenanceProcessor } from "./maintenance.processor.js";
import { OutboxRelayService } from "./outbox-relay.service.js";

/**
 * Worker-deployable half of the outbox (ADR 0037): relay poll loop, events
 * consumer (+ DLQ), and scheduled cleanup. Imported by `WorkerModule` ONLY —
 * the HTTP api never polls or consumes.
 *
 * Domain handler modules are imported HERE — the EventsProcessor resolves
 * `DOMAIN_EVENT_HANDLERS` in this module's DI context. Nest has no true
 * multi-provider, so this module OWNS the aggregation: each domain worker
 * module exports its handler CLASS, and the variadic factory below collects
 * them into the one array the processor injects. `pnpm gen module` appends
 * to both anchor lists.
 */
@Module({
  imports: [
    JobsModule,
    ProjectsWorkerModule,
    OrdersWorkerModule,
    InvoicesWorkerModule,
    // @gen:worker-modules — `pnpm gen module` injects the domain worker module here.
  ],
  providers: [
    OutboxRelayService,
    EventsProcessor,
    MaintenanceProcessor,
    {
      provide: DOMAIN_EVENT_HANDLERS,
      useFactory: (...handlers: DomainEventHandler[]): DomainEventHandler[] => handlers,
      inject: [
        ProjectsEventsHandler,
        OrdersEventsHandler,
        InvoicesEventsHandler,
        // @gen:domain-event-handlers — `pnpm gen module` injects the handler class here.
      ],
    },
  ],
})
export class OutboxWorkerModule {}
