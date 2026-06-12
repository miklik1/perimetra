import { describe, expect, it, vi } from "vitest";

import { runMock, stripApiPrefix } from "./core/dispatch";
import { dispatchMockError } from "./core/response-envelope";
import { MockHttpError, type MockRoute } from "./core/types";

describe("stripApiPrefix", () => {
  it("strips a real prefix segment, leaves prefix-adjacent paths intact", () => {
    expect(stripApiPrefix("/api/users", "/api")).toBe("/users");
    expect(stripApiPrefix("/api", "/api")).toBe("/");
    expect(stripApiPrefix("/apidocs", "/api")).toBe("/apidocs"); // boundary guard
    expect(stripApiPrefix("/users", undefined)).toBe("/users");
  });
});

describe("dispatchMockError", () => {
  it("maps MockHttpError to its status + envelope", () => {
    const res = dispatchMockError(new MockHttpError(409, "CONFLICT", "nope"));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: "nope", code: "CONFLICT" });
  });

  it("maps a ZodError-like to 422", () => {
    const res = dispatchMockError({ name: "ZodError", issues: [] });
    expect(res.status).toBe(422);
    expect((res.body as { code: string }).code).toBe("VALIDATION_ERROR");
  });

  it("maps anything else to 500", () => {
    expect(dispatchMockError(new Error("boom")).status).toBe(500);
    expect(dispatchMockError("weird").status).toBe(500);
  });
});

describe("runMock latency (delayRange)", () => {
  const route: MockRoute = { method: "GET", pattern: "/ping", handler: () => ({ data: "pong" }) };

  it("awaits the configured delay before resolving", async () => {
    vi.useFakeTimers();
    try {
      let resolved = false;
      const promise = runMock(new Request("http://x/ping"), {
        routes: [route],
        delayRange: [50, 50],
      }).then((r) => {
        resolved = true;
        return r;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(false); // still waiting on the 50ms delay
      await vi.advanceTimersByTimeAsync(50);
      const result = await promise;
      expect(resolved).toBe(true);
      expect(result?.body).toBe("pong");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns null on no match (caller decides 404 vs passthrough)", async () => {
    expect(await runMock(new Request("http://x/nope"), { routes: [route] })).toBeNull();
  });
});
