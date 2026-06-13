import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { CatalogVersionsModule } from "../catalog-versions/catalog-versions.module.js";
import { ReleasesController } from "./releases.controller.js";
import { ReleasesRepository } from "./releases.repository.js";
import { ReleasesService } from "./releases.service.js";

/**
 * Releases module (ADR 0053) — the immutable vendor release store.
 * No OutboxModule: vendor data has no realtime/worker consumers.
 * Imports CatalogVersionsModule so the publish gate can validate a release
 * against its catalog version (cross-module read via the owning service).
 * `AuditService` arrives via the `@Global()` AuditModule.
 *
 * `ReleasesService` is exported: the quotes module (I3 re-derivation) resolves
 * `SiteStamps.releaseIds` through it.
 */
@Module({
  imports: [AuthModule, CatalogVersionsModule],
  controllers: [ReleasesController],
  providers: [ReleasesService, ReleasesRepository],
  exports: [ReleasesService],
})
export class ReleasesModule {}
