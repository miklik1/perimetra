import { ClsPluginTransactional } from "@nestjs-cls/transactional";
import { TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Module } from "@nestjs/common";
import { ClsModule } from "nestjs-cls";
import { LoggerModule } from "nestjs-pino";

import { ConfigModule } from "./common/config/config.module.js";
import { ENV, type Env } from "./common/config/env.js";
import { DB, DbModule } from "./common/db/db.module.js";
import { AnalyticsModule } from "./modules/analytics/analytics.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { JobsModule } from "./modules/jobs/jobs.module.js";
import { OutboxWorkerModule } from "./modules/outbox/outbox-worker.module.js";
import { PrivacyWorkerModule } from "./modules/privacy/privacy-worker.module.js";
import { OtelMetricsModule } from "./otel/metrics.module.js";

/**
 * Worker DI container: same foundations as AppModule, no HTTP. Queue
 * processor modules are imported here (and ONLY here) — ADR 0031/0043.
 */
@Module({
  imports: [
    ConfigModule,
    DbModule,
    LoggerModule.forRootAsync({
      useFactory: (env: Env) => ({
        pinoHttp: { level: env.LOG_LEVEL },
      }),
      inject: [ENV],
    }),
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
    JobsModule,
    OutboxWorkerModule,
    // GDPR plumbing (spec §7.7, ADR 0040): audit writer for worker-side
    // handlers + privacy queue processor (export/erase/audit-cleanup).
    AnalyticsModule,
    AuditModule,
    PrivacyWorkerModule,
    OtelMetricsModule,
  ],
})
export class WorkerModule {}
