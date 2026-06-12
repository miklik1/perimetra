/**
 * GDPR erasure end-to-end (spec §7.7, ADR 0040, spec §14): the REAL worker
 * deployable (WorkerModule — privacy processor on live BullMQ consumers)
 * runs next to the REAL api app, both against the shared containers.
 *
 * Flow under test: authenticated `POST /v1/privacy/erase` (202) → privacy
 * queue → PrivacyProcessor → projects HARD-deleted (erasure beats
 * soft-delete), user row anonymized (not deleted — FKs stay valid),
 * sessions + accounts deleted, audit row `privacy.erase` written.
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { audit } from "@repo/db/schema/audit";
import { account, session, user as userTable } from "@repo/db/schema/auth";
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

  it("erases the user: projects hard-deleted, user anonymized, audit row written", async () => {
    const user: TestUser = await signUpUser(app, "privacy-erase");

    // Two projects; one soft-deleted — soft-deleted PII is still PII
    // (spec §6), so erasure must hard-delete BOTH.
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
    });

    // Session and credential account ROWS are gone. (No 401 assertion on
    // the old cookie here: Better Auth's signed cookie cache —
    // `cookieCache.maxAge: 300` in auth.instance.ts — answers getSession()
    // without a store round-trip for up to 5 minutes by design, so
    // revocation propagates within that window rather than instantly.)
    expect(await db.select().from(session).where(eq(session.userId, user.id))).toHaveLength(0);
    expect(await db.select().from(account).where(eq(account.userId, user.id))).toHaveLength(0);

    // Projects HARD-deleted — including the soft-deleted one (no deletedAt
    // filter here on purpose: the rows must not exist at all).
    expect(await db.select().from(project).where(eq(project.ownerId, user.id))).toHaveLength(0);

    // Erasure is itself an Art. 30 processing activity — audit row, system
    // actor (the worker has no acting user).
    const auditRows = await db
      .select()
      .from(audit)
      .where(and(eq(audit.action, "privacy.erase"), eq(audit.entityId, user.id)));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ entityType: "user", actorId: null });
  });
});
