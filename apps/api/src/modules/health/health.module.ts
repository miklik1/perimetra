import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";

import { AuthModule } from "../auth/auth.module.js";
import { HealthController } from "./health.controller.js";

@Module({
  // AuthModule exports the shared REDIS client the readiness probe pings.
  imports: [TerminusModule, AuthModule],
  controllers: [HealthController],
})
export class HealthModule {}
