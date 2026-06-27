import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { LegalProfilesController } from "./legal-profiles.controller.js";
import { LegalProfilesRepository } from "./legal-profiles.repository.js";
import { LegalProfilesService } from "./legal-profiles.service.js";

/**
 * Legal-profiles module (ADR 0088): controller + service + org-scoped singleton
 * repository. `LegalProfilesService` is EXPORTED so the quotes module can FREEZE
 * the supplier block at issue (a cross-module read through the owning service,
 * never a schema join — CLAUDE.md). `AuditService` is `@Global()`; no outbox
 * (config data, no event fan-out).
 */
@Module({
  imports: [AuthModule],
  controllers: [LegalProfilesController],
  providers: [LegalProfilesService, LegalProfilesRepository],
  exports: [LegalProfilesService],
})
export class LegalProfilesModule {}
