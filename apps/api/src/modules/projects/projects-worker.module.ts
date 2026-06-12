import { Module } from "@nestjs/common";

import { AnalyticsModule } from "../analytics/analytics.module.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import { ProjectsEventsHandler } from "./projects.events.js";
import { ProjectsRepository } from "./projects.repository.js";

/**
 * Worker half of the reference resource (ADR 0031): provides + exports the
 * domain event handler CLASS. `OutboxWorkerModule` (which hosts the events
 * processor) imports every domain worker module and aggregates the handlers
 * under `DOMAIN_EVENT_HANDLERS` — Nest has no true multi-provider, so the
 * processor's module owns the one array and `pnpm gen module` appends to it.
 * Worker deployable only, never the HTTP api.
 *
 * `RealtimeService` is provided directly (it only needs ENV): importing
 * `RealtimeModule` would drag its controller + SessionGuard + AuthModule
 * into the worker container.
 */
@Module({
  imports: [AnalyticsModule],
  providers: [ProjectsRepository, RealtimeService, ProjectsEventsHandler],
  exports: [ProjectsEventsHandler],
})
export class ProjectsWorkerModule {}
