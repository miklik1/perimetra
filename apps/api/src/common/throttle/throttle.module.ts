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
import { type FastifyInstance, type FastifyRequest } from "fastify";
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

/**
 * Route config consumed by the auth mount (AuthModule applies it). Two tiers
 * (ADR 0044): credential POSTs (sign-in / sign-up / reset) keep the strict
 * `AUTH_RATE_LIMIT_MAX`; the high-frequency session-management flow on
 * `/get-session` — which the Better Auth web client fires on every
 * window-focus and AuthGuard mount — gets the generous
 * `AUTH_SESSION_RATE_LIMIT_MAX`, so normal multi-tab / multi-page use never
 * trips the limit into a spurious logout.
 *
 * The generous tier covers BOTH methods on `/get-session`: the `GET` read AND
 * the client's `POST /get-session` session-REFRESH (better-auth fires it when a
 * get-session response sets `needsRefresh`, e.g. `session.deferSessionRefresh`).
 * Both are the same session-management hot path; gating only on GET would drop
 * the refresh POST into the strict tier and reintroduce the silent-logout the
 * widening exists to kill (caught by the adversarial verify pass — the gap is
 * latent while `deferSessionRefresh` is off, active once a project enables it).
 *
 * Tier selection matches by EXACT path suffix + method, NEVER a raw-URL
 * substring: `request.url` carries the query string, so a
 * `.includes("/get-session")` check would let `POST /sign-in/email?x=/get-session`
 * steal the generous tier — a ~30× brute-force bypass on the credential
 * endpoints. Strip the query, then match the path suffix. Widening to POST does
 * NOT loosen any credential endpoint: those are per-action paths
 * (`/sign-in/email`, `/sign-up/email`, `/reset-password`, …) — none end in
 * `/get-session`.
 *
 * PATH-scoped to the `/get-session` suffix ONLY (least privilege): `list-sessions`
 * and the `organization` reads are enumeration / permission-probe surfaces and
 * nothing polls them, so they stay strict. Caveat: any future plugin route that
 * also ends in `/get-session` (e.g. the Better Auth MCP plugin's
 * `/mcp/get-session`) would inherit the generous tier — scope this tighter if
 * you enable one and don't want that. Likewise, if a project enables
 * `organizationClient()` and polls an org read, OR adds a `useSession`
 * `refetchInterval`, add that exact path to the read tier here too.
 */
export function authRateLimitConfig(env: Env) {
  return {
    rateLimit: {
      max: (request: FastifyRequest) => {
        const path = request.url.split("?")[0] ?? "";
        const isSessionRead =
          (request.method === "GET" || request.method === "POST") && path.endsWith("/get-session");
        return isSessionRead ? env.AUTH_SESSION_RATE_LIMIT_MAX : env.AUTH_RATE_LIMIT_MAX;
      },
      timeWindow: "1 minute",
    },
  };
}
