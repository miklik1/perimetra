import { ClsPluginTransactional } from "@nestjs-cls/transactional";
import { TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ClsModule } from "nestjs-cls";
import { LoggerModule } from "nestjs-pino";

import { apiSemanticsProviders } from "./common/api/zod.js";
import { ConfigModule } from "./common/config/config.module.js";
import { ENV, type Env } from "./common/config/env.js";
import { DB, DbModule } from "./common/db/db.module.js";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter.js";
import { IdempotencyModule } from "./common/idempotency/idempotency.module.js";
import { buildRedactPaths, redactedReqSerializer } from "./common/logging/redaction.js";
import { AppThrottleModule } from "./common/throttle/throttle.module.js";
import { AnalyticsModule } from "./modules/analytics/analytics.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { SessionGuard } from "./modules/auth/session.guard.js";
import { CatalogVersionsModule } from "./modules/catalog-versions/catalog-versions.module.js";
import { CustomersModule } from "./modules/customers/customers.module.js";
import { EmailModule } from "./modules/email/email.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { InvoicesModule } from "./modules/invoices/invoices.module.js";
import { JobsModule } from "./modules/jobs/jobs.module.js";
import { LedgerModule } from "./modules/ledger/ledger.module.js";
import { LegalProfilesModule } from "./modules/legal-profiles/legal-profiles.module.js";
import { LookupsModule } from "./modules/lookups/lookups.module.js";
import { NavModule } from "./modules/nav/nav.module.js";
import { OrdersModule } from "./modules/orders/orders.module.js";
import { OutboxModule } from "./modules/outbox/outbox.module.js";
import { PlatformModule } from "./modules/platform/platform.module.js";
import { PriceTablesModule } from "./modules/price-tables/price-tables.module.js";
import { PrivacyModule } from "./modules/privacy/privacy.module.js";
import { ProjectsModule } from "./modules/projects/projects.module.js";
import { OrgProvisioningModule } from "./modules/provisioning/org-provisioning.module.js";
import { QuotesModule } from "./modules/quotes/quotes.module.js";
import { RealtimeModule } from "./modules/realtime/realtime.module.js";
import { ReleaseDraftsModule } from "./modules/release-drafts/release-drafts.module.js";
import { ReleasesModule } from "./modules/releases/releases.module.js";
import { StorageModule } from "./modules/storage/storage.module.js";
import { OtelMetricsModule } from "./otel/metrics.module.js";

// @gen:api-module-imports — `pnpm gen module` injects the module import here.

@Module({
  imports: [
    ConfigModule,
    DbModule,
    // Structured logs with request-id correlation. Redaction by default
    // (ADR 0036/0040): auth material, PII-bearing headers, and every pii()
    // column as body paths (buildRedactPaths) never land in logs.
    LoggerModule.forRootAsync({
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          // Static auth material + every pii() column as body paths (ADR 0040).
          redact: { paths: buildRedactPaths(), censor: "[redacted]" },
          // pino logs the querystring inside `req.url` (a redact path can't
          // reach a value inside a string) and emits a parsed `req.query`
          // object (a `?q=<email>` search's key isn't a pii() column, so no
          // redact path covers it). redactedReqSerializer closes both
          // fail-closed: cut the querystring off `url` and drop `query`. It
          // must NOT re-serialize — pino-http already did (see its docstring).
          serializers: { req: redactedReqSerializer },
          genReqId: (req) =>
            (req.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID(),
          ...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
        },
      }),
      inject: [ENV],
    }),
    // Ambient transaction context (ADR 0037): `@Transactional()` services +
    // `TransactionHost` resolve the active Drizzle tx from CLS — repositories
    // and the outbox writer can't accidentally escape the business
    // transaction.
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
      plugins: [
        new ClsPluginTransactional({
          imports: [DbModule],
          adapter: new TransactionalAdapterDrizzleOrm({
            drizzleInstanceToken: DB,
          }),
        }),
      ],
    }),
    AnalyticsModule,
    AuthModule,
    EmailModule,
    JobsModule,
    OutboxModule,
    StorageModule,
    RealtimeModule,
    AppThrottleModule,
    HealthModule,
    // API semantics + GDPR plumbing (spec §7.7/§7.8, §8; ADR 0039/0040):
    // idempotency replay cache, global audit writer, privacy self-service
    // endpoints, reference resource.
    IdempotencyModule,
    AuditModule,
    PrivacyModule,
    ProjectsModule,
    OtelMetricsModule,
    ReleasesModule,
    CatalogVersionsModule,
    PriceTablesModule,
    QuotesModule,
    // Platform/vendor console (ADR 0062): per-tenant release assignment.
    PlatformModule,
    // New-org default provisioning (ADR 0063): assigns the vendor-configured
    // default release set when a fresh org is auto-provisioned. HTTP app only.
    OrgProvisioningModule,
    ReleaseDraftsModule,
    CustomersModule,
    LegalProfilesModule,
    // Public-register lookups (ADR 0090): ARES (IČO) prefill + VIES (DIČ) validation.
    LookupsModule,
    OrdersModule,
    LedgerModule,
    InvoicesModule,
    // Nav-count aggregate (1c-3): GET /v1/me/nav-counts for the app-shell pills.
    NavModule,
    // @gen:api-modules — `pnpm gen module` injects the module here.
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    // Default-deny authz (ADR 0099): SessionGuard runs on EVERY Nest route —
    // a hand-rolled controller that forgets auth ships protected, not public.
    // `@Public()` (modules/auth/public.decorator.ts) is the explicit opt-out.
    // Runs after the ThrottlerGuard (imported modules' APP_GUARDs register
    // first), matching the old throttle-then-auth order.
    { provide: APP_GUARD, useClass: SessionGuard },
    // Global zod semantics (spec §8): 422-envelope validation pipe +
    // response-stripping serializer interceptor (common/api/zod.ts).
    ...apiSemanticsProviders,
  ],
})
export class AppModule {}
