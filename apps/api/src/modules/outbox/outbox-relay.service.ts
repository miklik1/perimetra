/**
 * The publish half of the outbox (ADR 0037) — worker deployable only.
 *
 * Poll loop (NO LISTEN/NOTIFY — ADR 0038: transaction-pooling-safe): every
 * `OUTBOX_RELAY_INTERVAL_MS`, claim a batch with `FOR UPDATE SKIP LOCKED`
 * (concurrency-safe across N worker replicas — two relays can never claim
 * the same row), enqueue each event to BullMQ with `jobId = event id`
 * (consumer-side dedup), and mark it published — in ONE transaction, so a
 * crash mid-batch releases the claims untouched.
 *
 * Enqueue failures increment `attempts`; rows go `dead` after
 * MAX_PUBLISH_ATTEMPTS (poison rows surface in bull-board/metrics rather
 * than blocking the stream).
 */
import { InjectQueue } from "@nestjs/bullmq";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { Queue } from "bullmq";
import { asc, eq, sql } from "drizzle-orm";

import { type Db } from "@repo/db";
import { outbox } from "@repo/db/schema/outbox";

import { ENV, type Env } from "../../common/config/env.js";
import { DB } from "../../common/db/db.module.js";
import { QUEUES } from "../jobs/jobs.tokens.js";

const BATCH_SIZE = 50;
const MAX_PUBLISH_ATTEMPTS = 10;

@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  private inFlight: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    @InjectQueue(QUEUES.events) private readonly events: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      // Serialize ticks: a slow batch must not overlap the next interval.
      this.inFlight = this.inFlight.then(async () => {
        try {
          await this.relayBatch();
        } catch (error) {
          this.logger.error(error instanceof Error ? (error.stack ?? error.message) : error);
        }
      });
    }, this.env.OUTBOX_RELAY_INTERVAL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.inFlight; // drain the in-progress batch
  }

  /** One claim-publish-mark cycle. Exposed for tests. */
  async relayBatch(): Promise<number> {
    if (this.stopped) return 0;

    return await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(outbox)
        .where(eq(outbox.status, "pending"))
        .orderBy(asc(outbox.id))
        .limit(BATCH_SIZE)
        .for("update", { skipLocked: true });

      for (const row of rows) {
        try {
          await this.events.add(
            row.eventType,
            {
              eventId: row.id,
              aggregateType: row.aggregateType,
              aggregateId: row.aggregateId,
              eventType: row.eventType,
              payload: row.payload,
              ...(row.traceparent ? { traceparent: row.traceparent } : {}),
            },
            { jobId: row.id },
          );
          await tx
            .update(outbox)
            .set({ status: "published", publishedAt: new Date() })
            .where(eq(outbox.id, row.id));
        } catch (error) {
          const attempts = row.attempts + 1;
          await tx
            .update(outbox)
            .set({
              attempts,
              ...(attempts >= MAX_PUBLISH_ATTEMPTS ? { status: "dead" as const } : {}),
            })
            .where(eq(outbox.id, row.id));
          this.logger.error(
            `enqueue failed for outbox ${row.id} (attempt ${attempts})` +
              (attempts >= MAX_PUBLISH_ATTEMPTS ? " — marked dead" : ""),
            error instanceof Error ? error.stack : undefined,
          );
        }
      }

      return rows.length;
    });
  }

  /** Retention (ADR 0040 defaults): published rows are deleted after 30 days. */
  async cleanup(): Promise<void> {
    await this.db
      .delete(outbox)
      .where(
        sql`${outbox.status} = 'published' and ${outbox.publishedAt} < now() - interval '30 days'`,
      );
  }
}
