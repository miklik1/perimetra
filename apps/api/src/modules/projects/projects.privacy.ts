/**
 * Projects' GDPR handler (ADR 0040): export lists the projects the user created
 * (Art. 20 portability — `ownerId` is the creator/audit ref, ADR 0055).
 *
 * Erasure is a NO-OP by design. A project is ORG-scoped data (the access scope
 * is `organizationId`; `ownerId` only records who created it), so a departing
 * member's projects belong to the org and its co-members, NOT to the person —
 * deleting by `ownerId` would destroy live org data (the pre-ADR-0055 owner-
 * scoped assumption). The person's PII is severed centrally: the privacy
 * processor anonymizes the Better Auth `user` row (name/email → erased
 * sentinel) AFTER this handler runs, so the retained `ownerId` then points at a
 * PII-free principal. This is the same stance the immutable I3 quote/price_table
 * stores take (ON DELETE RESTRICT + user-row anonymize, ADR 0055) — org records
 * survive erasure while their author goes PII-free.
 */
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { type Db } from "@repo/db";
import { project } from "@repo/db/schema/projects";

import { DB } from "../../common/db/db.module.js";
import { stripInternalColumns } from "../privacy/privacy-export.mapper.js";
import { type PrivacyHandler } from "../privacy/privacy.tokens.js";

@Injectable()
export class ProjectsPrivacyHandler implements PrivacyHandler {
  readonly entityType = "project";

  constructor(@Inject(DB) private readonly db: Db) {}

  async exportUser(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(project).where(eq(project.ownerId, userId));
    return { projects: stripInternalColumns(rows) };
  }

  async eraseUser(): Promise<void> {
    // Intentionally empty — org data is retained; the user-row anonymization in
    // the privacy processor removes the PII. Idempotent (jobs retry).
  }
}
