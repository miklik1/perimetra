import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { ReleaseDraftsController } from "./release-drafts.controller.js";
import { ReleaseDraftsRepository } from "./release-drafts.repository.js";
import { ReleaseDraftsService } from "./release-drafts.service.js";

/**
 * Release-drafts module (ADR 0068 Phase 3) — the MUTABLE author workspace:
 * controller + service + scoped repository. Imports `AuthModule` for the
 * `SessionGuard` + `PlatformGuard` (vendor-only authoring). No `OutboxModule`:
 * drafts emit no domain events (autosave would spam Centrifugo, with no
 * consumer). `AuditService` arrives via the `@Global()` AuditModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [ReleaseDraftsController],
  providers: [ReleaseDraftsService, ReleaseDraftsRepository],
})
export class ReleaseDraftsModule {}
