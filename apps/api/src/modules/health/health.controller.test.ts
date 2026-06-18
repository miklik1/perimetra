/**
 * HealthController — the liveness/readiness probe logic. `live()` is dependency-
 * free (the `@SkipThrottle` class + `check([])`); `ready()` fans out to
 * `pingDb`/`pingRedis`, each of which maps a reachable dependency to `up()` and
 * a thrown one to `down({ message })` — including the `instanceof Error` branch
 * for the message. Unit-level here; the wired-probe HTTP path is `app.boot.test`.
 */
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

  it("ready() marks db DOWN with the Error message when the query throws", async () => {
    const { controller, down } = makeController({ dbThrows: new Error("pg gone") });
    await controller.ready();
    expect(down).toHaveBeenCalledWith({ message: "pg gone" });
  });

  it("ready() falls back to 'unreachable' for a non-Error redis rejection", async () => {
    const { controller, down } = makeController({ redisThrows: "boom-string" });
    await controller.ready();
    expect(down).toHaveBeenCalledWith({ message: "unreachable" });
  });
});
