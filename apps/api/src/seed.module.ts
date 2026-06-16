/**
 * SeedModule — minimal DI container for the golden-corpus seed (WS4,
 * admin-publish slice). Mirrors WorkerModule's CLS/transactional wiring so
 * `@Transactional()` publish methods work in the standalone context.
 *
 * Only the three publish modules (catalog-versions, releases, price-tables)
 * plus their required foundations are imported — no HTTP adapter, no queue
 * infra, no auth HTTP handler.
 */
import { ClsPluginTransactional } from "@nestjs-cls/transactional";
import { TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Module } from "@nestjs/common";
import { ClsModule } from "nestjs-cls";

import { ConfigModule } from "./common/config/config.module.js";
import { DB, DbModule } from "./common/db/db.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { CatalogVersionsModule } from "./modules/catalog-versions/catalog-versions.module.js";
import { PriceTablesModule } from "./modules/price-tables/price-tables.module.js";
import { ReleasesModule } from "./modules/releases/releases.module.js";

@Module({
  imports: [
    ConfigModule,
    DbModule,
    // CLS + transactional adapter — identical wiring to WorkerModule so that
    // the @Transactional() decorators on publish services function correctly in
    // the standalone application context (no HTTP request lifecycle).
    ClsModule.forRoot({
      global: true,
      plugins: [
        new ClsPluginTransactional({
          imports: [DbModule],
          adapter: new TransactionalAdapterDrizzleOrm({
            drizzleInstanceToken: DB,
          }),
        }),
      ],
    }),
    // @Global() — AuditService available everywhere in the container.
    AuditModule,
    // The three publish modules (each exports its service).
    CatalogVersionsModule,
    ReleasesModule,
    PriceTablesModule,
  ],
})
export class SeedModule {}
