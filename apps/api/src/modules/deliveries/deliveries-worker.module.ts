import { Module } from "@nestjs/common";

import { EmailModule } from "../email/email.module.js";
import { DeliveriesEventsHandler } from "./deliveries.events.js";
import { DeliveriesRepository } from "./deliveries.repository.js";

/**
 * Worker half of the deliveries module (ADR 0031, ADR 0129): provides + exports
 * the domain event handler CLASS. `OutboxWorkerModule` imports this module and
 * aggregates every handler under `DOMAIN_EVENT_HANDLERS` (Nest has no true
 * multi-provider, so the events processor's module owns the array).
 *
 * `EmailModule` is imported — NOT `DeliveriesModule`. Importing the api module
 * would drag its controller (and therefore `SessionGuard` + `AuthModule`) into
 * the worker container, which is exactly what the ADR-0031 api/worker split
 * exists to prevent. `EmailModule` is safe to import because it has no
 * controller and its only dependency is `ENV` from the `@Global()` ConfigModule.
 * That also closes the "worker DI gap": nothing in `worker.module.ts` needs
 * editing, because `OutboxWorkerModule` is already imported there and now
 * transitively carries the mail seam.
 *
 * `RealtimeService` is deliberately absent (unlike the other worker modules):
 * A2 publishes nothing to Centrifugo.
 */
@Module({
  imports: [EmailModule],
  providers: [DeliveriesRepository, DeliveriesEventsHandler],
  exports: [DeliveriesEventsHandler],
})
export class DeliveriesWorkerModule {}
