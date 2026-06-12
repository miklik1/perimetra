import { Logger } from "@nestjs/common";

import { type PurgeHook } from "../privacy.tokens.js";

/**
 * Sentry purge (ADR 0040, honest version): Sentry exposes NO per-user
 * server-side deletion API for SDKs — user data is minimized at the source
 * instead (`sendDefaultPii: false` + the PII scrubber in sentry/init.ts), so
 * events should not contain personal data to begin with. Residual deletion
 * (e.g. a user id appearing in an error message) goes through Sentry's data
 * deletion request flow — this hook logs that obligation so the erasure
 * audit trail records it.
 */
export class SentryPurgeHook implements PurgeHook {
  readonly name = "sentry";
  private readonly logger = new Logger(SentryPurgeHook.name);

  async purgeUser(userId: string): Promise<void> {
    if (!process.env.SENTRY_DSN) return;
    this.logger.log(
      `sentry purge for ${userId}: events are PII-scrubbed at source; ` +
        "residual references require a Sentry data-deletion request (manual/API per org policy)",
    );
  }
}
