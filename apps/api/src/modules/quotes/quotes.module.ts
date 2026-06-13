import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { CatalogVersionsModule } from "../catalog-versions/catalog-versions.module.js";
import { PriceTablesModule } from "../price-tables/price-tables.module.js";
import { ReleasesModule } from "../releases/releases.module.js";
import { QuotesController } from "./quotes.controller.js";
import { QuotesRepository } from "./quotes.repository.js";
import { QuotesService } from "./quotes.service.js";

/**
 * Quotes module (ADR 0053) — the I3 core. Imports the three immutable stores it
 * resolves stamps against (releases + catalog + price tables) via their owning
 * services (cross-module reads, never schema joins). `AuditService` is `@Global()`.
 */
@Module({
  imports: [AuthModule, ReleasesModule, CatalogVersionsModule, PriceTablesModule],
  controllers: [QuotesController],
  providers: [QuotesService, QuotesRepository],
})
export class QuotesModule {}
