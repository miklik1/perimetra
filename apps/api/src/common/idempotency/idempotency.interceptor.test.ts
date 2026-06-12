/**
 * Idempotency protocol against a mocked Redis: claim (SETNX) → store on
 * success, replay with `Idempotency-Replayed: true`, 409 while in flight,
 * claim release on handler failure, and the opt-in/no-op paths.
 */
import { ConflictException, type CallHandler, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { type Redis } from "ioredis";
import { lastValueFrom, of, throwError } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IdempotencyInterceptor } from "./idempotency.interceptor.js";
import { Idempotent } from "./idempotent.decorator.js";

const TTL = 24 * 60 * 60;
const KEY = "idempotency:u_1:POST:/v1/projects:k1";

class TestController {
  @Idempotent()
  create(): void {}

  plain(): void {}
}

const redis = { set: vi.fn(), get: vi.fn(), del: vi.fn() };
const reply = { statusCode: 201, header: vi.fn(), status: vi.fn() };

function makeRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    method: "POST",
    url: "/v1/projects?limit=5",
    headers: { "idempotency-key": "k1" },
    sessionContext: { user: { id: "u_1" } },
    ...overrides,
  };
}

function makeContext(
  request: Record<string, unknown>,
  handler: (...args: never[]) => unknown = TestController.prototype.create,
): ExecutionContext {
  return {
    getType: () => "http",
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
  } as unknown as ExecutionContext;
}

function makeNext(
  result: unknown = { id: "p1" },
): CallHandler & { handle: ReturnType<typeof vi.fn> } {
  return { handle: vi.fn(() => of(result)) };
}

function makeInterceptor(): IdempotencyInterceptor {
  return new IdempotencyInterceptor(redis as unknown as Redis, new Reflector());
}

beforeEach(() => {
  vi.clearAllMocks();
  reply.statusCode = 201;
});

describe("IdempotencyInterceptor", () => {
  it("ignores routes without @Idempotent()", async () => {
    const next = makeNext();
    const result = await makeInterceptor().intercept(
      makeContext(makeRequest(), TestController.prototype.plain),
      next,
    );

    expect(await lastValueFrom(result)).toEqual({ id: "p1" });
    expect(next.handle).toHaveBeenCalledOnce();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("ignores requests without an Idempotency-Key header", async () => {
    const next = makeNext();
    const result = await makeInterceptor().intercept(
      makeContext(makeRequest({ headers: {} })),
      next,
    );

    expect(await lastValueFrom(result)).toEqual({ id: "p1" });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("ignores safe methods even on @Idempotent() routes", async () => {
    const next = makeNext();
    await makeInterceptor().intercept(makeContext(makeRequest({ method: "GET" })), next);

    expect(next.handle).toHaveBeenCalledOnce();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("claims the key (user+method+path scope, query stripped) and stores { status, body } on success", async () => {
    redis.set.mockResolvedValueOnce("OK"); // NX claim
    redis.set.mockResolvedValueOnce("OK"); // XX store
    const next = makeNext();

    const result = await makeInterceptor().intercept(makeContext(makeRequest()), next);
    expect(await lastValueFrom(result)).toEqual({ id: "p1" });

    expect(redis.set).toHaveBeenNthCalledWith(
      1,
      KEY,
      JSON.stringify({ pending: true }),
      "EX",
      TTL,
      "NX",
    );
    expect(redis.set).toHaveBeenNthCalledWith(
      2,
      KEY,
      JSON.stringify({ status: 201, body: { id: "p1" } }),
      "EX",
      TTL,
      "XX",
    );
  });

  it("replays the stored response with Idempotency-Replayed: true (handler never runs)", async () => {
    redis.set.mockResolvedValueOnce(null); // claim lost
    redis.get.mockResolvedValueOnce(JSON.stringify({ status: 201, body: { id: "p1" } }));
    const next = makeNext({ id: "SHOULD_NOT_RUN" });

    const result = await makeInterceptor().intercept(makeContext(makeRequest()), next);

    expect(await lastValueFrom(result)).toEqual({ id: "p1" });
    expect(next.handle).not.toHaveBeenCalled();
    expect(reply.header).toHaveBeenCalledWith("Idempotency-Replayed", "true");
    expect(reply.status).toHaveBeenCalledWith(201);
  });

  it("rejects a concurrent duplicate with 409 idempotency_in_flight", async () => {
    redis.set.mockResolvedValueOnce(null);
    redis.get.mockResolvedValueOnce(JSON.stringify({ pending: true }));

    const attempt = makeInterceptor().intercept(makeContext(makeRequest()), makeNext());
    await expect(attempt).rejects.toThrow(ConflictException);

    redis.set.mockResolvedValueOnce(null);
    redis.get.mockResolvedValueOnce(JSON.stringify({ pending: true }));
    const error = (await makeInterceptor()
      .intercept(makeContext(makeRequest()), makeNext())
      .catch((e: unknown) => e)) as ConflictException;
    expect(error.getResponse()).toMatchObject({ code: "idempotency_in_flight" });
  });

  it("releases the claim when the handler fails, so the key can be retried", async () => {
    redis.set.mockResolvedValueOnce("OK");
    redis.del.mockResolvedValueOnce(1);
    const next: CallHandler = { handle: () => throwError(() => new Error("boom")) };

    const result = await makeInterceptor().intercept(makeContext(makeRequest()), next);
    await expect(lastValueFrom(result)).rejects.toThrow("boom");

    expect(redis.del).toHaveBeenCalledWith(KEY);
    expect(redis.set).toHaveBeenCalledTimes(1); // claim only — nothing stored
  });
});
