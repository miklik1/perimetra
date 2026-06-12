import { Module } from "@nestjs/common";

import { OutboxService } from "./outbox.service.js";

/**
 * API-side outbox surface: just `OutboxService.emit()` for domain modules.
 * The relay + cleanup live in `OutboxWorkerModule` (worker deployable only).
 */
@Module({
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
