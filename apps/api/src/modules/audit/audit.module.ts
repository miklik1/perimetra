import { Global, Module } from "@nestjs/common";

import { AuditService } from "./audit.service.js";

/**
 * Audit surface (spec §7.7): just `AuditService.record()`. Marked `@Global()`
 * because every domain module audits its mutations — import it ONCE in
 * AppModule and WorkerModule and `AuditService` is injectable everywhere
 * (mirrors how DbModule is provided).
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
