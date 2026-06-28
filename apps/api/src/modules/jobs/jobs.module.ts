/**
 * BullMQ foundation (ADR 0043, spec §7.2).
 *
 * - One `BullModule.forRoot` connection config (BullMQ owns and closes its
 *   connections; `maxRetriesPerRequest: null` is a BullMQ requirement).
 * - Queues from the `QUEUES` registry, sane retry defaults, bounded Redis
 *   memory (`removeOnComplete`/`removeOnFail` ages).
 * - Repeatables-only cron: schedule via `upsertScheduler()` —
 *   `@nestjs/schedule` is BANNED (in-process cron fires once PER REPLICA;
 *   BullMQ job schedulers are Redis-coordinated and replica-safe).
 * - bull-board mounted on the raw Fastify instance behind basic auth, gated by
 *   an explicit `BULL_BOARD_ENABLED` flag (auto-on for local development only).
 *   It lives outside Nest's router, so Nest guards can't protect it — same
 *   constraint as the Better Auth mount; the prod-secret guard (env.ts) forces a
 *   strong password whenever it is enabled in production.
 */
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter as BullBoardFastifyAdapter } from "@bull-board/fastify";
import fastifyBasicAuth from "@fastify/basic-auth";
import { BullModule, getQueueToken } from "@nestjs/bullmq";
import { Inject, Module, Optional } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Queue } from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import { type FastifyInstance } from "fastify";

import { ENV, type Env } from "../../common/config/env.js";
import { QUEUES } from "./jobs.tokens.js";

function connectionFromUrl(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    // BullMQ requirement — it throws on a connection that can give up.
    maxRetriesPerRequest: null,
  };
}

const queueRegistrations = Object.values(QUEUES).map((name) =>
  BullModule.registerQueue({
    name,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: { age: 3_600, count: 1_000 },
      // Keep failures visible (bull-board, DLQ relay) but bounded.
      removeOnFail: { age: 7 * 24 * 3_600 },
    },
  }),
);

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (env: Env) => ({
        connection: connectionFromUrl(env.REDIS_URL),
        // bullmq-otel propagates trace context producer->consumer and emits
        // job metrics; no-op while the OTel SDK is down (ADR 0036).
        telemetry: new BullMQOtel("skeleton-jobs"),
      }),
      inject: [ENV],
    }),
    ...queueRegistrations,
  ],
  // Re-export so feature modules `imports: [JobsModule]` and `@InjectQueue`.
  exports: [BullModule],
})
export class JobsModule {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(getQueueToken(QUEUES.events)) private readonly events: Queue,
    @Inject(getQueueToken(QUEUES.dlq)) private readonly dlq: Queue,
    @Inject(getQueueToken(QUEUES.maintenance)) private readonly maintenance: Queue,
    @Inject(getQueueToken(QUEUES.privacy)) private readonly privacy: Queue,
    @Optional() private readonly adapterHost?: HttpAdapterHost,
  ) {}

  async onModuleInit(): Promise<void> {
    const fastify = this.adapterHost?.httpAdapter?.getInstance<FastifyInstance>();
    // Explicit opt-in for any deployed env; auto-on for local development only.
    // NODE_ENV inference alone exposed admin/admin on any staging that forgot
    // NODE_ENV=production — fail closed unless BULL_BOARD_ENABLED is set.
    const mount = this.env.BULL_BOARD_ENABLED || this.env.NODE_ENV === "development";
    if (!fastify || !mount) return;

    const serverAdapter = new BullBoardFastifyAdapter();
    createBullBoard({
      queues: [this.events, this.dlq, this.maintenance, this.privacy].map(
        (q) => new BullMQAdapter(q),
      ),
      serverAdapter,
    });
    serverAdapter.setBasePath("/admin/queues");

    const { env } = this;
    await fastify.register(async (instance) => {
      await instance.register(fastifyBasicAuth, {
        validate: async (username, password) => {
          if (username !== env.BULL_BOARD_USER || password !== env.BULL_BOARD_PASSWORD) {
            throw new Error("invalid credentials");
          }
        },
        authenticate: { realm: "queues" },
      });
      instance.addHook("onRequest", instance.basicAuth);
      await instance.register(serverAdapter.registerPlugin(), { prefix: "/admin/queues" });
    });
  }
}

/**
 * The ONE sanctioned cron mechanism (ADR 0043): a Redis-coordinated BullMQ
 * job scheduler — replica-safe by construction.
 */
export async function upsertScheduler(
  queue: Queue,
  schedulerId: string,
  repeat: { pattern: string; tz?: string } | { every: number },
  job: { name: string; data?: Record<string, unknown> },
): Promise<void> {
  await queue.upsertJobScheduler(schedulerId, repeat, {
    name: job.name,
    ...(job.data ? { data: job.data } : {}),
  });
}
