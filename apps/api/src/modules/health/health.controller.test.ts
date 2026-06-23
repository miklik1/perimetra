/**
 * HealthController — the liveness/readiness probe logic. `live()` is dependency-
 * free (the `@SkipThrottle` class + `check([])`); `ready()` fans out to
 * `pingDb`/`pingRedis`. `/health/ready` is unauthenticated + throttle-exempt
 * (ADR 0044), so a probe failure must report a GENERIC status — never the raw
 * driver error, which can carry the DSN/host/credentials — and the real reason
 * goes to the server log. Unit-level here; the wired-probe HTTP path is
 * `app.boot.test`.
 */
import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { HealthController } from "./health.controller.js";

/** A terminus-shaped `HealthCheckService.check` mock that actually INVOKES the
 *  indicator thunks (so `pingDb`/`pingRedis` run), then reports ok. */
function makeController(opts: { dbThrows?: unknown; redisThrows?: unknown }) {
  const up = vi.fn((key?: string) => ({ [key ?? "k"]: { status: "up" } }));
  const down = vi.fn((arg: Record<string, unknown>) => ({ status: "down", ...arg }));
  const indicator = { check: vi.fn(() => ({ up, down })) };

  const health = {
    check: vi.fn(async (thunks: Array<() => Promise<unknown>>) => {
      for (const t of thunks) await t();
      return { status: "ok", info: {}, error: {}, details: {} };
    }),
  };

  const db = {
    execute: vi.fn(() =>
      "dbThrows" in opts ? Promise.reject(opts.dbThrows) : Promise.resolve([{ "?column?": 1 }]),
    ),
  };
  const redis = {
    ping: vi.fn(() =>
      "redisThrows" in opts ? Promise.reject(opts.redisThrows) : Promise.resolve("PONG"),
    ),
  };

  const controller = new HealthController(
    health as never,
    indicator as never,
    db as never,
    redis as never,
  );
  return { controller, health, indicator, up, down, db, redis };
}

describe("HealthController", () => {
  it("live() reports ok without checking any dependency", async () => {
    const { controller, health } = makeController({});
    const result = await controller.live();
    expect(health.check).toHaveBeenCalledWith([]);
    expect(result.status).toBe("ok");
  });

  it("ready() marks db + redis UP when both are reachable", async () => {
    const { controller, up, down, db, redis } = makeController({});
    await controller.ready();
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(redis.ping).toHaveBeenCalledTimes(1);
    expect(up).toHaveBeenCalledTimes(2); // database + redis
    expect(down).not.toHaveBeenCalled();
  });

  it("ready() sanitizes a db failure to 'unreachable' and logs the real reason", async () => {
    // The driver message carries exactly the detail that must NOT leak.
    const secret = "ECONNREFUSED 10.1.2.3:5432 password=hunter2";
    const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { controller, down } = makeController({ dbThrows: new Error(secret) });
    await controller.ready();
    // Response is generic; the real reason reaches the SERVER LOG only.
    expect(down).toHaveBeenCalledWith({ message: "unreachable" });
    expect(errorSpy).toHaveBeenCalledWith(
      "database readiness check failed",
      expect.stringContaining(secret),
    );
    errorSpy.mockRestore();
  });

  it("ready() sanitizes a non-Error redis rejection to 'unreachable'", async () => {
    const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { controller, down } = makeController({ redisThrows: "boom-string" });
    await controller.ready();
    expect(down).toHaveBeenCalledWith({ message: "unreachable" });
    errorSpy.mockRestore();
  });
});
