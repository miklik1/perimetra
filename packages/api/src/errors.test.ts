import { describe, expect, it } from "vitest";

import { ApiError, parseRetryAfter } from "./client/create-api-client";
import {
  errorContext,
  fieldErrors,
  isConflict,
  isForbidden,
  isHttpError,
  isNotFound,
  isRateLimited,
  isRetryable,
  isServerError,
  isUnauthorized,
  isValidation,
  retryAfterMs,
} from "./errors";

function httpError(status: number, extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) {
  return new ApiError({ kind: "http", status, message: "x", ...extra });
}

describe("status predicates", () => {
  it("classify each status", () => {
    expect(isUnauthorized(httpError(401))).toBe(true);
    expect(isForbidden(httpError(403))).toBe(true);
    expect(isNotFound(httpError(404))).toBe(true);
    expect(isConflict(httpError(409))).toBe(true);
    expect(isValidation(httpError(422))).toBe(true);
    expect(isRateLimited(httpError(429))).toBe(true);
    expect(isServerError(httpError(503))).toBe(true);
    expect(isHttpError(httpError(400))).toBe(true);
  });

  it("ignore non-ApiError and non-http errors", () => {
    expect(isUnauthorized(new Error("plain"))).toBe(false);
    expect(isServerError(new ApiError({ kind: "network", status: 0, message: "x" }))).toBe(false);
  });
});

describe("isRetryable", () => {
  it("retries network, 5xx, and 429", () => {
    expect(isRetryable(new ApiError({ kind: "network", status: 0, message: "x" }))).toBe(true);
    expect(isRetryable(httpError(500))).toBe(true);
    expect(isRetryable(httpError(429))).toBe(true);
  });

  it("does not retry other 4xx or parse errors", () => {
    expect(isRetryable(httpError(400))).toBe(false);
    expect(isRetryable(httpError(404))).toBe(false);
    expect(isRetryable(new ApiError({ kind: "parse", status: 200, message: "x" }))).toBe(false);
    expect(isRetryable("nope")).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  it("parses a delta-seconds value", () => {
    expect(parseRetryAfter("120")).toBe(120_000);
  });

  it("parses an HTTP-date into a forward delay", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(5000);
  });

  it("returns undefined for missing or garbage values", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("not-a-date")).toBeUndefined();
  });
});

describe("error accessors", () => {
  it("reads retryAfterMs and fieldErrors off the error", () => {
    const err = httpError(422, {
      retryAfterMs: 3000,
      fieldErrors: { email: ["taken"] },
    });
    expect(retryAfterMs(err)).toBe(3000);
    expect(fieldErrors(err)).toEqual({ email: ["taken"] });
    expect(retryAfterMs(new Error("x"))).toBeUndefined();
    expect(fieldErrors(new Error("x"))).toBeUndefined();
  });

  it("errorContext extracts the observability fields for ApiError only", () => {
    const err = httpError(422, { code: "validation", fieldErrors: { email: ["taken"] } });
    expect(errorContext(err)).toEqual({
      kind: "http",
      status: 422,
      code: "validation",
      fieldErrors: { email: ["taken"] },
    });
    expect(errorContext(new Error("x"))).toBeUndefined();
  });
});
