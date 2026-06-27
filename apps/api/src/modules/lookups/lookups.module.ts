import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { LookupsController } from "./lookups.controller.js";
import { LookupsService } from "./lookups.service.js";

/**
 * Registry-lookups module (ADR 0090) — an outbound-lookup module. Owns NO schema,
 * repository, outbox, or worker: it proxies the public CZ ARES register and the
 * EU VIES service and shapes the result (fail-soft). Imports `AuthModule` only,
 * for `SessionGuard`/`RolesGuard`. Nothing imports it back (inbound-only) — see
 * CONTEXT.md.
 */
@Module({
  imports: [AuthModule],
  controllers: [LookupsController],
  providers: [LookupsService],
})
export class LookupsModule {}
