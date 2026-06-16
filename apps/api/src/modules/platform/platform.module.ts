import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { ReleasesModule } from "../releases/releases.module.js";
import { PlatformController } from "./platform.controller.js";

/**
 * Platform/vendor console module (ADR 0062) — the cross-tenant operator surface
 * (release assignment + discovery). Owns NO schema/services of its own: it
 * orchestrates `ReleasesService` (assignment writes + global list, from
 * ReleasesModule) and `OrganizationsService` + `PlatformGuard` (from AuthModule)
 * — cross-module reads through owning services, never a schema join (ADR 0032).
 */
@Module({
  imports: [AuthModule, ReleasesModule],
  controllers: [PlatformController],
})
export class PlatformModule {}
