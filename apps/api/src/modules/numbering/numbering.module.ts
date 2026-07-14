import { Module } from "@nestjs/common";

import { NumberingService } from "./numbering.service.js";

/**
 * Shared document-number allocator (ADR 0109). Providers that issue numbered
 * documents (orders now; invoices at ADR-O2) import this module and inject
 * `NumberingService`. No controller, no schema ownership beyond
 * `@repo/db/schema/numbering`; `TransactionHost` comes from the global CLS
 * transactional setup, so there is nothing else to wire.
 */
@Module({
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
