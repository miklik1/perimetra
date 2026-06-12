import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { ProjectsController } from "./projects.controller.js";
import { ProjectsRepository } from "./projects.repository.js";
import { ProjectsService } from "./projects.service.js";

/**
 * API half of the reference resource (spec §7.8): controller + service +
 * scoped repository. The event handler lives in `ProjectsWorkerModule` —
 * the HTTP deployable never consumes queues (ADR 0031).
 *
 * `AuditService` arrives via the `@Global()` AuditModule (registered once
 * in AppModule) — not imported here, per audit.module.ts's convention.
 */
@Module({
  imports: [AuthModule, OutboxModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepository],
})
export class ProjectsModule {}
