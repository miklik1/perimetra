/**
 * Probes (version-neutral — orchestrators hit fixed paths):
 * - `/health/live`  — process is up; never checks dependencies (a dead DB
 *   must not get the pod killed, only taken out of rotation).
 * - `/health/ready` — fit for traffic: DB + Redis reachable.
 */
import { Controller, Get, Inject, Logger, VERSION_NEUTRAL } from "@nestjs/common";
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  type HealthCheckResult,
  type HealthIndicatorResult,
} from "@nestjs/terminus";
import { SkipThrottle } from "@nestjs/throttler";
import { sql } from "drizzle-orm";
import { type Redis } from "ioredis";

import { type Db } from "@repo/db";

import { DB } from "../../common/db/db.module.js";
import { REDIS } from "../auth/auth.tokens.js";
import { Public } from "../auth/public.decorator.js";

// Probes are exempt from the global Redis-backed ThrottlerGuard (ADR 0044): an
// orchestrator hits them constantly, and `/health/live` must answer even when
// Redis is down (the guard's storage eval would otherwise 500 the liveness
// probe and get a healthy pod killed — the exact failure CI's infra-less test
// job surfaced).
// Public (ADR 0099): orchestrators/load balancers probe without credentials —
// liveness/readiness must never require a session.
@Public()
@SkipThrottle()
@Controller({ path: "health", version: VERSION_NEUTRAL })
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get("live")
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Get("ready")
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([() => this.pingDb(), () => this.pingRedis()]);
  }

  private async pingDb(): Promise<HealthIndicatorResult> {
    const check = this.indicator.check("database");
    try {
      await this.db.execute(sql`select 1`);
      return check.up();
    } catch (error) {
      // Log the real reason server-side; the readiness RESPONSE carries only a
      // generic status. `/health/ready` is unauthenticated and throttle-exempt,
      // so a raw `error.message` (DSN, host, driver internals) would leak to any
      // caller — readiness tells an orchestrator a dependency is down, not why.
      this.logger.error("database readiness check failed", asStack(error));
      return check.down({ message: "unreachable" });
    }
  }

  private async pingRedis(): Promise<HealthIndicatorResult> {
    const check = this.indicator.check("redis");
    try {
      await this.redis.ping();
      return check.up();
    } catch (error) {
      // See pingDb: sanitized status out, real reason to the server log only.
      this.logger.error("redis readiness check failed", asStack(error));
      return check.down({ message: "unreachable" });
    }
  }
}

/** Server-log detail for a probe failure — never reaches the HTTP response. */
function asStack(error: unknown): string | undefined {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
