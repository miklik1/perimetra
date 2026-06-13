import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { CatalogVersionsController } from "./catalog-versions.controller.js";
import { CatalogVersionsRepository } from "./catalog-versions.repository.js";
import { CatalogVersionsService } from "./catalog-versions.service.js";

/**
 * Catalog-versions module (ADR 0053) — the immutable vendor catalog store.
 * No OutboxModule: the store has no realtime/worker consumers (vendor data).
 * `AuditService` arrives via the `@Global()` AuditModule.
 *
 * `CatalogVersionsService` is exported: the releases module (publish gate) and
 * the quotes module (I3 re-derivation) resolve catalogs through it — the
 * cross-module read goes through the owning service, never a schema join.
 */
@Module({
  imports: [AuthModule],
  controllers: [CatalogVersionsController],
  providers: [CatalogVersionsService, CatalogVersionsRepository],
  exports: [CatalogVersionsService],
})
export class CatalogVersionsModule {}
