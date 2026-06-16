/**
 * New-org provisioning hook registry (ADR 0063).
 *
 * Bridges the Better Auth `session.create.before` hook — which auto-provisions
 * one org per genuinely-new owner (ADR 0055) and lives in `auth.instance.ts` —
 * to the DOMAIN provisioning logic (default release assignment) WITHOUT a module
 * cycle. AuthModule is a leaf (CONTEXT.md: "auth is a leaf; domain modules depend
 * on IT, never the reverse"); it must never import ReleasesModule (which already
 * imports AuthModule — the reverse edge would be uncompilable).
 *
 * So this is a mutable, AuthModule-owned registry: the AUTH factory passes
 * `run()` into `createAuth` as the `onOrgProvisioned` callback, and the
 * `OrgProvisioningModule` (which DOES import Releases) registers its closure on
 * init. `run()` reads the handler lazily, so registration order is irrelevant —
 * both modules share the one app-scoped singleton. Contexts that never load the
 * provisioning module (worker / seed / CLI) leave it unregistered → `run()` is a
 * no-op, so their auth instances never auto-provision.
 */
import { Injectable, Logger } from "@nestjs/common";

/** Invoked once per genuinely-new org (the auth hook's `(org.id, ownerUserId)`). */
export type OnOrgProvisioned = (organizationId: string, ownerUserId: string) => Promise<void>;

@Injectable()
export class OrgProvisioningHook {
  private readonly logger = new Logger(OrgProvisioningHook.name);
  private handler?: OnOrgProvisioned;

  /** Wire the domain provisioning closure (OrgProvisioningModule, on init). */
  register(handler: OnOrgProvisioned): void {
    this.handler = handler;
  }

  /**
   * Run provisioning for a freshly-created org. FAIL-SOFT by contract: a
   * provisioning error must NEVER block the user's first session — a failed
   * default assignment degrades to today's empty-org state (recoverable via a
   * seed re-run or a manual `/platform` assign), it does not fail login.
   */
  async run(organizationId: string, ownerUserId: string): Promise<void> {
    if (!this.handler) return;
    try {
      await this.handler(organizationId, ownerUserId);
    } catch (err) {
      this.logger.error(
        `default provisioning failed for org ${organizationId} (owner ${ownerUserId}) — ` +
          `org lands empty, recoverable via seed re-run`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
