import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { PriceTablesController } from "./price-tables.controller.js";
import { PriceTablesRepository } from "./price-tables.repository.js";
import { PriceTablesService } from "./price-tables.service.js";

/**
 * Price-tables module (ADR 0053) — per-tenant versioned price store.
 * No OutboxModule (no realtime consumers). `AuditService` is `@Global()`.
 *
 * `PriceTablesService` is exported: the quotes module resolves the active price
 * table (and stamps its version) through it at issue time.
 */
@Module({
  imports: [AuthModule],
  controllers: [PriceTablesController],
  providers: [PriceTablesService, PriceTablesRepository],
  exports: [PriceTablesService],
})
export class PriceTablesModule {}
