/**
 * Transactional outbox end-to-end (ADR 0037, spec §14): a real HTTP create
 * commits the outbox row with the project (one transaction), then ONE
 * `relayBatch()` — the worker's claim-publish-mark cycle — publishes it to
 * the REAL BullMQ `events` queue on the Redis container, with
 * `jobId = event id` (the consumer-side dedup key).
 *
 * The relay is instantiated directly (it lives in the worker deployable, not
 * AppModule) but over the app's REAL Drizzle db and REAL queue — nothing is
 * faked.
 */
import { getQueueToken } from "@nestjs/bullmq";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { type Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { outbox } from "@repo/db/schema/outbox";

import { ENV, type Env } from "../src/common/config/env.js";
import { DB } from "../src/common/db/db.module.js";
import { QUEUES } from "../src/modules/jobs/jobs.tokens.js";
import { OutboxRelayService } from "../src/modules/outbox/outbox-relay.service.js";
import { PROJECT_CREATED } from "../src/modules/projects/projects.tokens.js";
import { createApiApp, inject, signUpUser } from "./setup/app.js";

describe("outbox relay (real Postgres + real BullMQ queue)", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let events: Queue;

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    events = app.get<Queue>(getQueueToken(QUEUES.events));
  });

  afterAll(async () => {
    await app.close();
  });

  it("create → pending row → relayBatch() → published row + queue job with jobId = event id", async () => {
    const user = await signUpUser(app, "outbox");

    // 1. Real HTTP create — service + outbox emit share one transaction.
    const created = await inject(app, {
      method: "POST",
      url: "/v1/projects",
      headers: { cookie: user.cookie },
      payload: { name: "Outbox probe" },
    });
    expect(created.statusCode).toBe(201);
    const projectId = (created.json() as { id: string }).id;

    // 2. The committed outbox row is pending and carries the event contract.
    const [row] = await db.select().from(outbox).where(eq(outbox.aggregateId, projectId));
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      status: "pending",
      aggregateType: "project",
      eventType: PROJECT_CREATED,
      payload: { projectId },
      publishedAt: null,
    });

    // 3. One relay cycle against the real queue. Loop until the pending set
    //    is drained — earlier itest files share this database, so their
    //    pending rows ride along (claimed in id order, batches of 50).
    const relay = new OutboxRelayService(db, events, app.get<Env>(ENV));
    for (let i = 0; i < 20; i++) {
      if ((await relay.relayBatch()) === 0) break;
    }

    // 4. Row is published…
    const [published] = await db.select().from(outbox).where(eq(outbox.id, row!.id));
    expect(published!.status).toBe("published");
    expect(published!.publishedAt).not.toBeNull();

    // 5. …and the job sits on the REAL events queue, jobId = event id
    //    (ADR 0037 dedup contract), payload IDs-only.
    const job = await events.getJob(row!.id);
    expect(job).toBeDefined();
    expect(job!.id).toBe(row!.id);
    expect(job!.name).toBe(PROJECT_CREATED);
    expect(job!.data).toMatchObject({
      eventId: row!.id,
      aggregateType: "project",
      aggregateId: projectId,
      eventType: PROJECT_CREATED,
      payload: { projectId },
    });
  });

  it("relayBatch() is exactly-once per row: a second cycle re-publishes nothing", async () => {
    const relay = new OutboxRelayService(db, events, app.get<Env>(ENV));
    // Everything was drained above; an immediate re-run claims zero rows.
    expect(await relay.relayBatch()).toBe(0);
  });
});
