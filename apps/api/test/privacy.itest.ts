/**
 * GDPR erasure end-to-end (spec §7.7, ADR 0040, spec §14): the REAL worker
 * deployable (WorkerModule — privacy processor on live BullMQ consumers)
 * runs next to the REAL api app, both against the shared containers.
 *
 * Flow under test: authenticated `POST /v1/privacy/erase` (202) → privacy
 * queue → PrivacyProcessor → org-scoped projects RETAINED (org data, not the
 * person's — the personal link is severed by anonymizing the user row, matching
 * the immutable I3 quote/price_table stance, ADR 0055), user row anonymized
 * (not deleted — FKs stay valid), sessions + accounts deleted, audit row
 * `privacy.erase` written.
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { audit } from "@repo/db/schema/audit";
import { account, session, twoFactor, user as userTable } from "@repo/db/schema/auth";
import { project } from "@repo/db/schema/projects";

import { DB } from "../src/common/db/db.module.js";
import { WorkerModule } from "../src/worker.module.js";
import { createApiApp, inject, signUpUser, waitFor, type TestUser } from "./setup/app.js";

describe("privacy erasure (real worker + queue)", () => {
  let app: NestFastifyApplication;
  let worker: TestingModule;
  let db: Db;

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    // The real worker container: BullMQ consumers (events/maintenance/
    // privacy/dlq) start on init and process against the Redis container.
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
  });

  /**
   * Wait for the erasure job's LAST DATABASE artifact and return the audit row.
   *
   * The anonymized-email flip this test waits on is only the FIRST statement of
   * the processor's step 3, and `PrivacyProcessor.eraseUser()` is not wrapped in
   * `@Transactional()` (privacy.processor.ts) — it holds a TransactionHost purely
   * to join an ambient tx where one exists, and the BullMQ worker path has none.
   * Every statement autocommits on its own, so that flip publishes nothing about
   * what follows it: the `session`, `account` and `twoFactor` deletes later in
   * step 3, and — across the unbounded third-party purge hooks of step 4 (Sentry
   * + PostHog, real network) — the `privacy.erase` audit row of step 5. Reading
   * any of those straight off the step-3 signal is a race that only reddens on a
   * SLOW run, which is exactly what a loaded CI box is; it then passes on re-run,
   * which is how a real ordering defect gets waved through as a flake.
   *
   * Step 5 is the processor's last database write, so waiting on it orders every
   * earlier artifact too: the handler fan-out and finalize pass (steps 1-2), the
   * core erasures (step 3), and the purge hooks (step 4). Only `job.returnvalue`
   * lands after it, and that goes to Redis, not Postgres — a future step that
   * WROTE to the database past this point would need its own wait.
   */
  async function waitForEraseAudit(userId: string): Promise<typeof audit.$inferSelect> {
    let rows: (typeof audit.$inferSelect)[] = [];
    await waitFor(
      async () => {
        rows = await db
          .select()
          .from(audit)
          .where(and(eq(audit.action, "privacy.erase"), eq(audit.entityId, userId)));
        return rows.length > 0;
      },
      { label: `privacy.erase audit row for ${userId} (processor step 5)` },
    );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  it("erases the user: org projects retained, user anonymized, audit row written", async () => {
    const user: TestUser = await signUpUser(app, "privacy-erase");

    // Seed a TOTP enrollment (the platform-operator credential, ADR 0040) to
    // prove erasure PURGES it — the FK cascade can't fire on the anonymized
    // (not deleted) user row, so the processor must delete it explicitly.
    await db.insert(twoFactor).values({
      id: `tf-${user.id}`,
      secret: "enc-secret",
      backupCodes: "enc-backup",
      userId: user.id,
    });
    await db.update(userTable).set({ twoFactorEnabled: true }).where(eq(userTable.id, user.id));

    // Two projects; one soft-deleted. Both are ORG-scoped data (ADR 0055) —
    // erasure must NOT delete them; the user-row anonymization severs the
    // personal link, so the org keeps its records (same as the I3 stores).
    const kept = await inject(app, {
      method: "POST",
      url: "/v1/projects",
      headers: { cookie: user.cookie },
      payload: { name: "Privacy kept" },
    });
    expect(kept.statusCode).toBe(201);
    const softDeleted = await inject(app, {
      method: "POST",
      url: "/v1/projects",
      headers: { cookie: user.cookie },
      payload: { name: "Privacy soft-deleted" },
    });
    expect(softDeleted.statusCode).toBe(201);
    const softDeletedId = (softDeleted.json() as { id: string }).id;
    const removed = await inject(app, {
      method: "DELETE",
      url: `/v1/projects/${softDeletedId}`,
      headers: { cookie: user.cookie },
    });
    expect(removed.statusCode).toBe(204);

    // Self-service erasure — 202, the work happens on the privacy queue.
    const erase = await inject(app, {
      method: "POST",
      url: "/v1/privacy/erase",
      headers: { cookie: user.cookie },
    });
    expect(erase.statusCode).toBe(202);
    expect(erase.json()).toMatchObject({ status: "queued" });

    // The worker consumes the job; anonymized email marks completion.
    await waitFor(
      async () => {
        const [row] = await db.select().from(userTable).where(eq(userTable.id, user.id));
        return row?.email.startsWith("erased-") ?? false;
      },
      { label: "privacy.erase to be processed by the worker" },
    );

    // User row anonymized in place (not deleted — FK targets stay valid).
    const [erased] = await db.select().from(userTable).where(eq(userTable.id, user.id));
    expect(erased).toMatchObject({
      id: user.id,
      email: `erased-${user.id}@erased.invalid`,
      name: `erased-${user.id}@erased.invalid`,
      image: null,
      twoFactorEnabled: false,
    });

    // Everything below reads artifacts the step-3 email flip does NOT order —
    // wait on the processor's last database write first (see the helper).
    const auditRow = await waitForEraseAudit(user.id);

    // Session and credential account ROWS are gone. (No 401 assertion on
    // the old cookie here: Better Auth's signed cookie cache — the env-driven
    // `cookieCache.maxAge` window (SESSION_COOKIE_CACHE_MAX_AGE_S, default 60s)
    // in auth.instance.ts — answers getSession() without a store round-trip for
    // that window by design, so revocation propagates within it, not instantly.)
    expect(await db.select().from(session).where(eq(session.userId, user.id))).toHaveLength(0);
    expect(await db.select().from(account).where(eq(account.userId, user.id))).toHaveLength(0);
    // The TOTP credential is purged too (ADR 0040 erasure path).
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, user.id))).toHaveLength(0);

    // Org projects RETAINED — the delete-by-ownerId data-loss bug is fixed.
    // Both rows survive (the kept one + the soft-deleted one); `ownerId` is
    // unchanged but now points at the anonymized user row, so the personal data
    // is gone while the org keeps its records (the I3 quote/price_table stance).
    const survivors = await db.select().from(project).where(eq(project.ownerId, user.id));
    expect(survivors).toHaveLength(2);

    // Erasure is itself an Art. 30 processing activity — audit row, system
    // actor (the worker has no acting user). The row itself was already awaited
    // above; the shape check is all that is left here.
    expect(auditRow).toMatchObject({ entityType: "user", actorId: null });
  });
});
