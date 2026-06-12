import { Logger } from "@nestjs/common";

import { type Env } from "../../../common/config/env.js";
import { type PurgeHook } from "../privacy.tokens.js";

/**
 * PostHog person deletion (ADR 0040): looks the person up by distinct_id
 * (= our user id, the ADR 0028 identity bridge) and deletes them WITH their
 * events via PostHog's REST API. Needs a personal API key + project id —
 * silently skips (with a log) when unconfigured. Fail-soft: erasure jobs
 * retry, and the deletion is idempotent (404 on re-run is success).
 */
export class PosthogPurgeHook implements PurgeHook {
  readonly name = "posthog";
  private readonly logger = new Logger(PosthogPurgeHook.name);

  constructor(private readonly env: Env) {}

  async purgeUser(userId: string): Promise<void> {
    const { POSTHOG_HOST, POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID } = this.env;
    if (!POSTHOG_PERSONAL_API_KEY || !POSTHOG_PROJECT_ID) {
      this.logger.log(`posthog purge for ${userId} skipped: personal API key/project id not set`);
      return;
    }
    const base = `${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/persons`;
    const headers = { Authorization: `Bearer ${POSTHOG_PERSONAL_API_KEY}` };

    const lookup = await fetch(`${base}/?distinct_id=${encodeURIComponent(userId)}`, { headers });
    if (!lookup.ok) {
      throw new Error(`posthog person lookup failed: ${lookup.status}`);
    }
    const body = (await lookup.json()) as { results?: { id: string }[] };
    const person = body.results?.[0];
    if (!person) {
      this.logger.log(`posthog purge for ${userId}: no person found (already absent)`);
      return;
    }

    const del = await fetch(`${base}/${person.id}/?delete_events=true`, {
      method: "DELETE",
      headers,
    });
    if (!del.ok && del.status !== 404) {
      throw new Error(`posthog person deletion failed: ${del.status}`);
    }
    this.logger.log(`posthog purge for ${userId}: person ${person.id} deleted (with events)`);
  }
}
