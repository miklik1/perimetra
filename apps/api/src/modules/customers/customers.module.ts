import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { CustomersController } from "./customers.controller.js";
import { CustomersRepository } from "./customers.repository.js";
import { CustomersService } from "./customers.service.js";

/**
 * Customers module (ADR 0082): controller + service + org/rep-scoped repository.
 * `CustomersService` is EXPORTED so the quotes module can resolve a buyer at
 * issue (the §92e VAT-status auto-fill) — a cross-module read through the owning
 * service, never a schema join (CLAUDE.md). The GDPR handler is registered in
 * `PrivacyWorkerModule` (the worker-side fan-out). `AuditService` is global.
 */
@Module({
  imports: [AuthModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository],
  exports: [CustomersService],
})
export class CustomersModule {}
