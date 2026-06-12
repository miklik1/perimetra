import { describe, expect, it } from "vitest";

import { redactString, scrubBreadcrumb, scrubEvent } from "./scrub";

const FILTERED = "[Filtered]";

describe("redactString", () => {
  it.each([
    ["bearer token", "auth failed: Bearer eyJabc.def123-x_y", `auth failed: ${FILTERED}`],
    ["bare JWT", "token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dBjftJeZ4CVP", `token=${FILTERED}`],
    ["email", "user john.doe+test@example.co.uk not found", `user ${FILTERED} not found`],
    ["rodné číslo with slash", "rc 900720/0004 rejected", `rc ${FILTERED} rejected`],
    ["rodné číslo spaced slash", "rc 900720 / 0004 rejected", `rc ${FILTERED} rejected`],
    ["slashless 10-digit RČ shape", "value 9007200004 invalid", `value ${FILTERED} invalid`],
    ["9-digit pre-1954 shape", "value 530101123 invalid", `value ${FILTERED} invalid`],
  ])("redacts %s", (_name, input, expected) => {
    expect(redactString(input)).toBe(expected);
  });

  it("leaves non-PII text untouched", () => {
    expect(redactString("GET /users?page=2 → 404 in 12345678 ns")).toBe(
      "GET /users?page=2 → 404 in 12345678 ns",
    );
    expect(redactString("order 12345 for user abc")).toBe("order 12345 for user abc");
  });
});

describe("scrubEvent", () => {
  it("walks nested structures, arrays included", () => {
    const event = {
      message: "login failed for john@example.com",
      extra: {
        attempts: [{ note: "rc 900720/0004" }, { note: "ok" }],
        count: 3,
      },
    };
    expect(scrubEvent(event)).toEqual({
      message: `login failed for ${FILTERED}`,
      extra: {
        attempts: [{ note: `rc ${FILTERED}` }, { note: "ok" }],
        count: 3,
      },
    });
  });

  it("redacts sensitive keys wholesale, wherever they sit", () => {
    const event = {
      request: {
        headers: { Authorization: "whatever shape", cookie: "sid=1" },
      },
      user: { email: "a@b.cz", id: "u1" },
      extra: { refresh_token: { nested: "object" }, password: "hunter2" },
    };
    expect(scrubEvent(event)).toEqual({
      request: { headers: { Authorization: FILTERED, cookie: FILTERED } },
      user: { email: FILTERED, id: "u1" },
      extra: { refresh_token: FILTERED, password: FILTERED },
    });
  });

  it("is pure — the input event is not mutated", () => {
    const event = { message: "mail a@b.cz", extra: { token: "t" } };
    const copy = structuredClone(event);
    scrubEvent(event);
    expect(event).toEqual(copy);
  });

  it("survives circular references without recursing forever", () => {
    type Node = { message: string; self?: unknown };
    const event: Node = { message: "ok" };
    event.self = event;
    expect(() => scrubEvent(event)).not.toThrow();
    expect(scrubEvent(event).message).toBe("ok");
  });

  it("clones diamond-shaped sharing instead of dropping the second reference", () => {
    const shared = { note: "mail a@b.cz", count: 1 };
    expect(scrubEvent({ a: shared, b: shared })).toEqual({
      a: { note: `mail ${FILTERED}`, count: 1 },
      b: { note: `mail ${FILTERED}`, count: 1 },
    });
    expect(scrubEvent([shared, shared])).toEqual([
      { note: `mail ${FILTERED}`, count: 1 },
      { note: `mail ${FILTERED}`, count: 1 },
    ]);
  });

  it("leaves structural SDK metadata untouched (source-map safety)", () => {
    const event = {
      release: "build-1234567890",
      environment: "production",
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                // Pure-numeric chunk name + dotted symbol would otherwise match
                // the RČ / JWT shapes.
                { filename: "/_next/static/chunks/123456789.js", function: "appModule.render.run" },
              ],
            },
            value: "login failed for john@example.com",
          },
        ],
      },
    };
    expect(scrubEvent(event)).toEqual({
      release: "build-1234567890",
      environment: "production",
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                { filename: "/_next/static/chunks/123456789.js", function: "appModule.render.run" },
              ],
            },
            value: `login failed for ${FILTERED}`,
          },
        ],
      },
    });
  });

  it("still redacts sensitive keys even when they look structural", () => {
    // SENSITIVE_KEYS wins over the structural exemption (no current overlap —
    // this pins the precedence should one ever appear under both).
    expect(scrubEvent({ email: "a@b.cz", filename: "ok.js" })).toEqual({
      email: FILTERED,
      filename: "ok.js",
    });
  });

  it("preserves null/undefined and non-object primitives", () => {
    expect(scrubEvent(null)).toBeNull();
    expect(scrubEvent(42)).toBe(42);
    expect(scrubEvent({ a: null, b: undefined })).toEqual({ a: null, b: undefined });
  });
});

describe("scrubBreadcrumb", () => {
  it("scrubs message and data like an event", () => {
    expect(
      scrubBreadcrumb({ message: "fetch as john@example.com", data: { token: "abc" } }),
    ).toEqual({ message: `fetch as ${FILTERED}`, data: { token: FILTERED } });
  });
});
