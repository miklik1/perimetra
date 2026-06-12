/**
 * Live relay-concurrency proof (ADR 0037): two relay instances over a REAL
 * Postgres must never double-publish — `FOR UPDATE SKIP LOCKED` partitions
 * the claims. Runs only when DATABASE_URL is set (local dev stack or CI
 * services); skipped otherwise. The Testcontainers suite (spec §14,
 * `pnpm --filter api test:integration`) makes the DB unconditional.
 */
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createDb } from "@repo/db";
import { outbox } from "@repo/db/schema/outbox";

import { type Env } from "../../common/config/env.js";
import { OutboxRelayService } from "./outbox-relay.service.js";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("outbox relay (live db)", () => {
  let handle: ReturnType<typeof createDb>;
  const insertedIds: string[] = [];

  beforeAll(() => {
    handle = createDb({ url: DATABASE_URL!, poolSize: 4 });
  });

  afterAll(async () => {
    if (insertedIds.length > 0) {
      await handle.db.delete(outbox).where(inArray(outbox.id, insertedIds));
    }
    await handle.close();
  });

  it("two concurrent relays publish 20 events exactly once each", async () => {
    const rows = await handle.db
      .insert(outbox)
      .values(
        Array.from({ length: 20 }, (_, i) => ({
          aggregateType: "test",
          aggregateId: `t-${i}`,
          eventType: "test.relay-race",
          payload: { i },
        })),
      )
      .returning({ id: outbox.id });
    insertedIds.push(...rows.map((r) => r.id));

    const enqueued: string[] = [];
    const makeQueue = () =>
      ({
        add: vi.fn(async (_name: string, _data: unknown, opts: { jobId: string }) => {
          enqueued.push(opts.jobId);
        }),
      }) as never;

    const env = { OUTBOX_RELAY_INTERVAL_MS: 500 } as Env;
    const relayA = new OutboxRelayService(handle.db, makeQueue(), env);
    const relayB = new OutboxRelayService(handle.db, makeQueue(), env);

    // Race both relays; loop until our rows are drained (other tests' rows
    // may interleave — we only assert on our own ids).
    for (let i = 0; i < 10; i++) {
      const [a, b] = await Promise.all([relayA.relayBatch(), relayB.relayBatch()]);
      if (a + b === 0) break;
    }

    const ours = enqueued.filter((id) => insertedIds.includes(id));
    expect(ours.toSorted()).toEqual([...insertedIds].toSorted());
    expect(new Set(ours).size).toBe(ours.length); // no double-publish

    const published = await handle.db
      .select({ id: outbox.id, status: outbox.status })
      .from(outbox)
      .where(inArray(outbox.id, insertedIds));
    expect(published.every((r) => r.status === "published")).toBe(true);
  });
});
