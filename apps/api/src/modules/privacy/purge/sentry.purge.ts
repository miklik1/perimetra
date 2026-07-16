import { Logger } from "@nestjs/common";

import { type PurgeHook, type PurgeOutcome } from "../privacy.tokens.js";

/**
 * Sentry purge (ADR 0040/1009/1010, honest version): Sentry exposes NO per-user
 * server-side deletion API for SDK data, so there is nothing this hook can CALL.
 * User data is minimized at the source instead — `sendDefaultPii: false` + the
 * `beforeSend` PII scrubber in `sentry/init.ts` (which drops auth material, the
 * request body/URL/querystring/referer per ADR 1009, and masks every
 * `pii()`-registered key). Events therefore carry no personal data to begin
 * with; any residual reference (e.g. a user id in an error message) is removed
 * via Sentry's manual data-deletion request per org policy.
 *
 * `purgeUser` reports this as a first-class `documented` {@link PurgeOutcome}
 * the processor records in the erasure read-model — the obligation is an
 * accounted-for step, never a swallowed void. It returns (does not throw): there
 * is no fallible call here, so nothing to escalate.
 */
export class SentryPurgeHook implements PurgeHook {
  readonly name = "sentry";
  private readonly logger = new Logger(SentryPurgeHook.name);

  async purgeUser(userId: string): Promise<PurgeOutcome> {
    if (!process.env.SENTRY_DSN) {
      return { status: "skipped", detail: "SENTRY_DSN not set" };
    }
    this.logger.log(
      `sentry purge for ${userId}: PII-scrubbed at source; residual removal via ` +
        "a Sentry data-deletion request (manual/API per org policy)",
    );
    return {
      status: "documented",
      detail:
        "no per-user Sentry deletion API; PII minimized at source, residual removal runbooked",
    };
  }
}
