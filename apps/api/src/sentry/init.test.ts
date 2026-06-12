import { describe, expect, it } from "vitest";

import { scrubEvent } from "./init.js";

type AnyEvent = Parameters<typeof scrubEvent>[0];

describe("sentry scrubEvent (ADR 0040)", () => {
  it("drops cookies/auth headers and masks PII-registry + secret keys", () => {
    const event = {
      request: {
        cookies: { session: "x" },
        headers: { cookie: "a=b", authorization: "Bearer x", accept: "application/json" },
      },
      extra: {
        // `email`/`name` are pii() columns (user table); `password` is a secret key.
        email: "martin@example.test",
        password: "hunter2",
        nested: { name: "Martin", safe: "keep-me" },
      },
      contexts: { state: { email: "x@y.cz", count: 3 } },
    } as unknown as AnyEvent;

    const scrubbed = scrubEvent(event) as unknown as {
      request: { cookies?: unknown; headers: Record<string, string> };
      extra: { email: string; password: string; nested: { name: string; safe: string } };
      contexts: { state: { email: string; count: number } };
    };

    expect(scrubbed.request.cookies).toBeUndefined();
    expect(scrubbed.request.headers.cookie).toBeUndefined();
    expect(scrubbed.request.headers.authorization).toBeUndefined();
    expect(scrubbed.request.headers.accept).toBe("application/json");
    expect(scrubbed.extra.email).toBe("[scrubbed]");
    expect(scrubbed.extra.password).toBe("[scrubbed]");
    expect(scrubbed.extra.nested.name).toBe("[scrubbed]");
    expect(scrubbed.extra.nested.safe).toBe("keep-me");
    expect(scrubbed.contexts.state.email).toBe("[scrubbed]");
    expect(scrubbed.contexts.state.count).toBe(3);
  });
});
