import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { PrivacyController } from "./privacy.controller.js";
import { PrivacyService } from "./privacy.service.js";

/**
 * API-side privacy surface (spec §7.7): the self-service GDPR endpoints +
 * `PrivacyService` for programmatic enqueueing. The fan-out/processor lives
 * in `PrivacyWorkerModule` (worker deployable only).
 */
@Module({
  imports: [JobsModule, AuthModule],
  controllers: [PrivacyController],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
