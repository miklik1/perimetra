/**
 * Rate limiting, two layers (ADR 0044 baseline):
 *
 * 1. Nest controller routes — `@nestjs/throttler` global guard, Redis-backed
 *    (shared across replicas; per user-or-IP). Override per route with
 *    `@Throttle()` / `@SkipThrottle()`.
 * 2. The raw `/api/auth/*` Fastify routes live OUTSIDE Nest's router, so the
 *    guard can't see them — `registerAuthRateLimit()` applies
 *    `@fastify/rate-limit` (same Redis) with the strict auth tier. Called
 *    from `main.ts` BEFORE the auth route registers; `skipOnError` keeps a
 *    Redis outage from locking everyone out (fail open, loudly).
 */
import rateLimit from "@fastify/rate-limit";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";

import { ENV, type Env } from "../config/env.js";

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: (env: Env) => ({
        throttlers: [{ name: "default", ttl: env.THROTTLE_TTL_MS, limit: env.THROTTLE_LIMIT }],
        storage: new ThrottlerStorageRedisService(
          new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 }),
        ),
      }),
      inject: [ENV],
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppThrottleModule {}

/** Strict per-IP tier for the Better Auth routes (registered in main.ts). */
export async function registerAuthRateLimit(fastify: FastifyInstance, env: Env): Promise<void> {
  await fastify.register(rateLimit, {
    global: false,
    redis: new Redis(env.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 500,
      maxRetriesPerRequest: 1,
    }),
    nameSpace: "rl:auth:",
    keyGenerator: (request) => request.ip,
    skipOnError: true,
  });
}

/** Route config consumed by the auth mount (AuthModule applies it). */
export function authRateLimitConfig(env: Env) {
  return { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: "1 minute" } };
}
