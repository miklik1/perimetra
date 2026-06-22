/**
 * Release-drafts GDPR handler (ADR 0040): export lists the drafts the user
 * authored (Art. 20 portability — `ownerId` is the creator/audit ref).
 *
 * Erasure is a NO-OP by design — the same reasoning as the projects handler. A
 * release draft is ORG-scoped (a vendor TEAM shares its org's drafts, ADR 0055);
 * `ownerId` only records the author. Deleting by `ownerId` would destroy the
 * org's in-progress authoring work when a member leaves. The person's PII is
 * severed centrally by the privacy processor anonymizing the Better Auth `user`
 * row after this handler runs, leaving `ownerId` pointing at a PII-free principal.
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

  async eraseUser(): Promise<void> {
    // Intentionally empty — org data is retained; the user-row anonymization in
    // the privacy processor removes the PII. Idempotent (jobs retry).
  }
}
