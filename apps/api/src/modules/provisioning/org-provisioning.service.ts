/**
 * Org provisioning service (ADR 0063) — the runtime analogue of the seed's
 * per-org bootstrap loop (`seed.ts`). When a genuinely-new owner is provisioned
 * an org (the Better Auth `session.create.before` hook, ADR 0055), assign the
 * vendor-configured DEFAULT release set so a fresh tenant lands with a populated
 * catalog instead of an empty palette.
 *
 * No default PRICE TABLE is provisioned: a fabricator's prices are their own
 * data, so the configurator degrades to a "publish a price table" notice until
 * the org publishes one (the "empty-but-honest" decision, ADR 0063) — never a
 * placeholder layer.
 */
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";

import { ENV, type Env } from "../../common/config/env.js";
import { ReleasesService } from "../releases/releases.service.js";

/**
 * Synthetic audit actor for system-provisioned assignments — mirrors the seed's
 * `system-seed`. Honest: the SYSTEM auto-assigned per the vendor's default-set
 * CONFIG, the owner did not choose these releases. `org_release_assignment.
 * assignedBy` is a soft text ref (no FK), so a synthetic id is safe.
 */
const SYSTEM_PROVISION_ACTOR = "system-provision";

@Injectable()
export class OrgProvisioningService {
  private readonly logger = new Logger(OrgProvisioningService.name);

  constructor(
    private readonly releases: ReleasesService,
    private readonly cls: ClsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Assign the configured default release set to a freshly-provisioned org.
   *
   * Runs OUTSIDE the Nest request pipeline (Better Auth is mounted raw on
   * Fastify — no ambient CLS), so each `@Transactional()` `assign` must open its
   * own transaction via `cls.run()`, exactly like the seed's `withSkip`. Each
   * assign is isolated: an id that isn't published yet (404) or is retired (409)
   * is logged and skipped without aborting the rest — `assign` is also idempotent
   * (ON CONFLICT DO NOTHING), so a redundant call is a safe no-op.
   */
  async provisionDefaults(organizationId: string, ownerUserId: string): Promise<void> {
    const releaseIds = this.env.PLATFORM_DEFAULT_RELEASE_IDS;
    if (releaseIds.length === 0) return;

    this.logger.log(
      `provisioning ${releaseIds.length} default release(s) for org ${organizationId} (owner ${ownerUserId})`,
    );

    for (const releaseId of releaseIds) {
      try {
        await this.cls.run(() =>
          this.releases.assign(SYSTEM_PROVISION_ACTOR, organizationId, releaseId),
        );
      } catch (err) {
        if (err instanceof NotFoundException || err instanceof ConflictException) {
          // EXPECTED: a default id that isn't published yet (404) or is retired
          // (409) — skip it, the others still get assigned (recoverable once
          // published). `assign` is also idempotent, so a redundant call no-ops.
          this.logger.warn(
            `default assign ${releaseId} → org ${organizationId} skipped: ${err.message}`,
          );
        } else {
          // UNEXPECTED (DB down, CLS misconfig, …) — re-throw so the failure is
          // NOT downgraded to a WARN. `OrgProvisioningHook.run` logs it at ERROR
          // and still keeps the session non-blocking (that catch is the fail-soft
          // backstop). Surfaces "every signup lands empty" to alerting.
          throw err;
        }
      }
    }
  }
}
