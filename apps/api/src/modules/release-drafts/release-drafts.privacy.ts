/**
 * Release-drafts GDPR handler (ADR 0040): export lists the user's authored
 * drafts (including soft-deleted — still their data); erasure HARD-deletes them
 * (erasure beats soft-delete). System-level DB access — privacy jobs run in the
 * worker with no request scope. Keyed by `ownerId` (the author), even though
 * the access scope is `organizationId`: GDPR erasure is about the person.
 */
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { type Db } from "@repo/db";
import { releaseDraft } from "@repo/db/schema/release-drafts";

import { DB } from "../../common/db/db.module.js";
import { type PrivacyHandler } from "../privacy/privacy.tokens.js";

@Injectable()
export class ReleaseDraftsPrivacyHandler implements PrivacyHandler {
  readonly entityType = "release-draft";

  constructor(@Inject(DB) private readonly db: Db) {}

  async exportUser(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(releaseDraft).where(eq(releaseDraft.ownerId, userId));
    return { releaseDrafts: rows };
  }

  async eraseUser(userId: string): Promise<void> {
    await this.db.delete(releaseDraft).where(eq(releaseDraft.ownerId, userId));
  }
}
