import { Module, type OnModuleInit } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { OrgProvisioningHook } from "../auth/org-provisioning-hook.js";
import { ReleasesModule } from "../releases/releases.module.js";
import { OrgProvisioningService } from "./org-provisioning.service.js";

/**
 * Org provisioning module (ADR 0063) — registers the runtime default-assignment
 * logic into the AuthModule-owned `OrgProvisioningHook` so a genuinely-new org
 * (auto-provisioned by the Better Auth `session.create.before` hook, ADR 0055)
 * lands with the vendor-configured default release set instead of empty.
 *
 * Owns NO schema/services of its own beyond the orchestrator: it imports
 * `AuthModule` (for `OrgProvisioningHook`) + `ReleasesModule` (for the exported
 * `ReleasesService`) and bridges them on init — cross-module reads through owning
 * services, never a schema join (ADR 0032). The reverse edge (Auth → Releases)
 * stays forbidden: AuthModule is a leaf, this module depends on it. Mirrors
 * `PlatformModule`'s orchestration shape.
 *
 * Loaded by the HTTP `AppModule` only — worker / seed / CLI contexts never
 * register the hook, so their auth instances never auto-provision (no-op).
 */
@Module({
  imports: [AuthModule, ReleasesModule],
  providers: [OrgProvisioningService],
})
export class OrgProvisioningModule implements OnModuleInit {
  constructor(
    private readonly hook: OrgProvisioningHook,
    private readonly provisioning: OrgProvisioningService,
  ) {}

  onModuleInit(): void {
    this.hook.register((organizationId, ownerUserId) =>
      this.provisioning.provisionDefaults(organizationId, ownerUserId),
    );
  }
}
