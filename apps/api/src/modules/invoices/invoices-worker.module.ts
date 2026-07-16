import { Module } from "@nestjs/common";

import { RealtimeService } from "../realtime/realtime.service.js";
import { InvoicesEventsHandler } from "./invoices.events.js";
import { InvoicesRepository } from "./invoices.repository.js";

/**
 * Worker half of the invoices module (ADR 0031): provides + exports the
 * domain event handler CLASS. `OutboxWorkerModule` imports this module and
 * aggregates every handler under `DOMAIN_EVENT_HANDLERS` (Nest has no true
 * multi-provider, so the events processor's module owns the array) —
 * `pnpm gen module` wired both anchors there.
 *
 * `RealtimeService` is provided directly (it only needs ENV): importing
 * `RealtimeModule` would drag its controller + SessionGuard + AuthModule
 * into the worker container.
 */
@Module({
  providers: [InvoicesRepository, RealtimeService, InvoicesEventsHandler],
  exports: [InvoicesEventsHandler],
})
export class InvoicesWorkerModule {}
