import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { CatalogVersionsModule } from "../catalog-versions/catalog-versions.module.js";
import { CustomersModule } from "../customers/customers.module.js";
import { LedgerModule } from "../ledger/ledger.module.js";
import { LegalProfilesModule } from "../legal-profiles/legal-profiles.module.js";
import { PriceTablesModule } from "../price-tables/price-tables.module.js";
import { ReleasesModule } from "../releases/releases.module.js";
import { QuotesPublicController } from "./quotes-public.controller.js";
import { QuotesController } from "./quotes.controller.js";
import { QuotesRepository } from "./quotes.repository.js";
import { QuotesService } from "./quotes.service.js";

/**
 * Quotes module (ADR 0053) — the I3 core. Imports the three immutable stores it
 * resolves stamps against (releases + catalog + price tables) via their owning
 * services (cross-module reads, never schema joins). `AuditService` is `@Global()`.
 * The margin floor is per-org (ADR 0059): read from the active price table's
 * `marginFloorPct` at issue, so there is no env/DI constant to wire here.
 */
@Module({
  imports: [
    AuthModule,
    ReleasesModule,
    CatalogVersionsModule,
    PriceTablesModule,
    CustomersModule,
    LegalProfilesModule,
    LedgerModule,
  ],
  controllers: [QuotesController, QuotesPublicController],
  providers: [QuotesService, QuotesRepository],
  // Exported for the orders module (ADR 0109): the quote-acceptance guard + the
  // re-homed production projection are cross-module reads through the service.
  exports: [QuotesService],
})
export class QuotesModule {}
