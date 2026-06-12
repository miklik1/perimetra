/**
 * Idempotency module (spec §8): owns a dedicated ioredis client (same
 * lazyConnect / bounded-retry posture as auth's — boot and DB-less tests must
 * not block on Redis, a down Redis fails requests loudly) and installs
 * `IdempotencyInterceptor` globally via `APP_INTERCEPTOR`. Importing this
 * module IS the wiring; routes still opt in per-handler with `@Idempotent()`,
 * so the interceptor is inert everywhere else.
 */
import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { Redis } from "ioredis";

import { ENV, type Env } from "../config/env.js";
import { IdempotencyInterceptor } from "./idempotency.interceptor.js";
import { IDEMPOTENCY_REDIS } from "./idempotency.tokens.js";

@Module({
  providers: [
    {
      provide: IDEMPOTENCY_REDIS,
      useFactory: (env: Env) =>
        new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 }),
      inject: [ENV],
    },
    IdempotencyInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: IdempotencyInterceptor },
  ],
  exports: [IdempotencyInterceptor, IDEMPOTENCY_REDIS],
})
export class IdempotencyModule implements OnApplicationShutdown {
  constructor(@Inject(IDEMPOTENCY_REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    // quit() would wait for a connection that (lazyConnect) may never open.
    if (this.redis.status === "wait" || this.redis.status === "end") {
      this.redis.disconnect();
      return;
    }
    await this.redis.quit();
  }
}
