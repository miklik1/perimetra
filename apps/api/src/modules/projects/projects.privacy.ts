/**
 * Projects' GDPR handler (ADR 0040): export lists the user's projects
 * (including soft-deleted — they're still personal data); erasure
 * HARD-deletes them (erasure beats soft-delete). System-level DB access —
 * privacy jobs run in the worker with no request scope.
 */
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { type Db } from "@repo/db";
import { project } from "@repo/db/schema/projects";

import { DB } from "../../common/db/db.module.js";
import { type PrivacyHandler } from "../privacy/privacy.tokens.js";

@Injectable()
export class ProjectsPrivacyHandler implements PrivacyHandler {
  readonly entityType = "project";

  constructor(@Inject(DB) private readonly db: Db) {}

  async exportUser(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(project).where(eq(project.ownerId, userId));
    return { projects: rows };
  }

  async eraseUser(userId: string): Promise<void> {
    await this.db.delete(project).where(eq(project.ownerId, userId));
  }
}
