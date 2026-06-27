/**
 * Legal-profiles GDPR handler (ADR 0040/0088). The only data subject linked here
 * is the platform USER (`ownerId` — the admin who created/last-edited the org's
 * legal identity). The profile itself is the fabricator's BUSINESS identity, not
 * a natural person's PII (ADR 0088), so:
 *
 * - export (Art. 20): the user's linkage to the profile(s) they last edited (ids
 *   + timestamps) — there is no personal data of the user IN the row to return.
 * - erase (Art. 17): NO-OP. The legal profile is ORG data (retained for the org +
 *   every issued daňový doklad that froze a copy); the user's own PII is
 *   anonymized centrally on the Better Auth `user` row, after which the retained
 *   `ownerId` points at a PII-free principal (the ADR-0055 stance).
 */
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { type Db } from "@repo/db";
import { legalProfile } from "@repo/db/schema/legal-profiles";

import { DB } from "../../common/db/db.module.js";
import { type PrivacyHandler } from "../privacy/privacy.tokens.js";

@Injectable()
export class LegalProfilesPrivacyHandler implements PrivacyHandler {
  readonly entityType = "legal-profile";

  constructor(@Inject(DB) private readonly db: Db) {}

  async exportUser(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select({ id: legalProfile.id, updatedAt: legalProfile.updatedAt })
      .from(legalProfile)
      .where(eq(legalProfile.ownerId, userId));
    return { legalProfiles: rows };
  }

  async eraseUser(): Promise<void> {
    // Intentionally empty — org data retained; the user's PII is anonymized on
    // the user row centrally. Idempotent (jobs retry).
  }
}
