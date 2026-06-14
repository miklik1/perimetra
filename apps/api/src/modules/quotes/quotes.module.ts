import { Module } from "@nestjs/common";

import { ENV, type Env } from "../../common/config/env.js";
import { AuthModule } from "../auth/auth.module.js";
import { CatalogVersionsModule } from "../catalog-versions/catalog-versions.module.js";
import { PriceTablesModule } from "../price-tables/price-tables.module.js";
import { ReleasesModule } from "../releases/releases.module.js";
import { QUOTE_MARGIN_FLOOR_PCT } from "./margin.js";
import { QuotesController } from "./quotes.controller.js";
import { QuotesRepository } from "./quotes.repository.js";
import { QuotesService } from "./quotes.service.js";

/**
 * Quotes module (ADR 0053) — the I3 core. Imports the three immutable stores it
 * resolves stamps against (releases + catalog + price tables) via their owning
 * services (cross-module reads, never schema joins). `AuditService` is `@Global()`.
 * The margin floor (ADR 0056) is an env-backed constant provider so itests can
 * `overrideProvider` it to exercise the guard without env gymnastics.
 */
@Module({
  imports: [AuthModule, ReleasesModule, CatalogVersionsModule, PriceTablesModule],
  controllers: [QuotesController],
  providers: [
    QuotesService,
    QuotesRepository,
    {
      provide: QUOTE_MARGIN_FLOOR_PCT,
      useFactory: (env: Env) => env.QUOTE_MARGIN_FLOOR_PCT,
      inject: [ENV],
    },
  ],
})
export class QuotesModule {}
