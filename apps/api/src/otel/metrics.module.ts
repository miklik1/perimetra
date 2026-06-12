/**
 * Async-machinery health gauges (ADR 0036) — the signals that say the
 * architecture's own plumbing is healthy (spec §11): queue depth, outbox
 * pending/lag, pg pool saturation. RED metrics come free from the http
 * instrumentation; these are the ones nothing emits for you.
 *
 * Uses the OTel API's global meter: when the SDK isn't started (OTel off)
 * the meter is a no-op and the callbacks never run — zero cost.
 */
import { getQueueToken } from "@nestjs/bullmq";
import { Inject, Module, Optional, type OnModuleInit } from "@nestjs/common";
import { metrics, ValueType } from "@opentelemetry/api";
import { Queue } from "bullmq";
import { sql } from "drizzle-orm";

import { type Db } from "@repo/db";

import { DB, DB_POOLS, type DbPools } from "../common/db/db.module.js";
import { JobsModule } from "../modules/jobs/jobs.module.js";
import { QUEUES } from "../modules/jobs/jobs.tokens.js";

interface OutboxStats {
  pending: number;
  lag: number;
}

@Module({ imports: [JobsModule] })
export class OtelMetricsModule implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DB_POOLS) private readonly pools: DbPools,
    @Inject(getQueueToken(QUEUES.events)) private readonly events: Queue,
    @Inject(getQueueToken(QUEUES.dlq)) private readonly dlq: Queue,
    @Inject(getQueueToken(QUEUES.maintenance)) private readonly maintenance: Queue,
    @Optional() @Inject(getQueueToken(QUEUES.privacy)) private readonly privacy?: Queue,
  ) {}

  private async outboxStats(): Promise<OutboxStats | undefined> {
    const result = (await this.db.execute(
      sql`select count(*)::int as pending,
             coalesce(extract(epoch from now() - min(created_at)), 0)::float as lag
          from outbox where status = 'pending'`,
    )) as unknown as { rows?: OutboxStats[] };
    return result.rows?.[0];
  }

  onModuleInit(): void {
    const meter = metrics.getMeter("skeleton");
    const queues = [this.events, this.dlq, this.maintenance, this.privacy].filter(
      (q): q is Queue => q !== undefined,
    );

    meter
      .createObservableGauge("queue.jobs", {
        description: "BullMQ job counts by queue and state",
        valueType: ValueType.INT,
      })
      .addCallback(async (observe) => {
        for (const queue of queues) {
          try {
            const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
            for (const [state, count] of Object.entries(counts)) {
              observe.observe(count, { queue: queue.name, state });
            }
          } catch {
            // Redis down — the readiness probe owns that signal.
          }
        }
      });

    meter
      .createObservableGauge("outbox.pending", {
        description: "Outbox rows not yet relayed",
        valueType: ValueType.INT,
      })
      .addCallback(async (observe) => {
        try {
          const stats = await this.outboxStats();
          if (stats) observe.observe(stats.pending);
        } catch {
          /* db down — readiness owns it */
        }
      });

    meter
      .createObservableGauge("outbox.lag_seconds", {
        description: "Age of the oldest pending outbox row",
      })
      .addCallback(async (observe) => {
        try {
          const stats = await this.outboxStats();
          if (stats) observe.observe(stats.lag);
        } catch {
          /* db down — readiness owns it */
        }
      });

    meter
      .createObservableGauge("db.pool.connections", {
        description: "pg pool connections by state (ADR 0038 saturation signal)",
        valueType: ValueType.INT,
      })
      .addCallback((observe) => {
        const pool = this.pools.primary;
        observe.observe(pool.totalCount, { state: "total" });
        observe.observe(pool.idleCount, { state: "idle" });
        observe.observe(pool.waitingCount, { state: "waiting" });
      });
  }
}
