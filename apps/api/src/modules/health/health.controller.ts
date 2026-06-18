/**
 * Probes (version-neutral — orchestrators hit fixed paths):
 * - `/health/live`  — process is up; never checks dependencies (a dead DB
 *   must not get the pod killed, only taken out of rotation).
 * - `/health/ready` — fit for traffic: DB + Redis reachable.
 */
import { Controller, Get, Inject, VERSION_NEUTRAL } from "@nestjs/common";
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

// Probes are exempt from the global Redis-backed ThrottlerGuard (ADR 0044): an
// orchestrator hits them constantly, and `/health/live` must answer even when
// Redis is down (the guard's storage eval would otherwise 500 the liveness
// probe and get a healthy pod killed — the exact failure CI's infra-less test
// job surfaced).
@SkipThrottle()
@Controller({ path: "health", version: VERSION_NEUTRAL })
export class HealthController {
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
      return check.down({
        message: error instanceof Error ? error.message : "unreachable",
      });
    }
  }

  private async pingRedis(): Promise<HealthIndicatorResult> {
    const check = this.indicator.check("redis");
    try {
      await this.redis.ping();
      return check.up();
    } catch (error) {
      return check.down({
        message: error instanceof Error ? error.message : "unreachable",
      });
    }
  }
}
