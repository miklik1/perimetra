import { describe, expect, it } from "vitest";

import { buildSentryOptions } from "./sentry-options";

const FILTERED = "[Filtered]";
// A JWT-shaped token (three base64url segments) — matched by the PII value
// patterns in scrub.ts, so a real backend leaking one in a URL is scrubbed.
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dBjftJeZ4CVP";

describe("buildSentryOptions — tracing scrub hooks", () => {
  const opts = buildSentryOptions({ dsn: "https://key@sentry.io/1" });

  it("wires the scrubber into the transaction and span pipelines", () => {
    // Tracing is a separate envelope path in Sentry v10 — without these hooks
    // span/transaction PII ships unscrubbed once tracesSampleRate > 0.
    expect(typeof opts.beforeSendTransaction).toBe("function");
    expect(typeof opts.beforeSendSpan).toBe("function");
  });

  it("beforeSendTransaction scrubs a token in the request URL and the auth header", () => {
    const result = opts.beforeSendTransaction!({
      type: "transaction",
      transaction: "GET /api/users",
      request: {
        url: `https://app.example.com/api/users?token=${JWT}`,
        headers: { Authorization: "Bearer secret-token-xyz" },
      },
    } as never) as { request: { url: string; headers: { Authorization: string } } };

    expect(result.request.url).not.toContain(JWT);
    expect(result.request.url).toContain(FILTERED);
    expect(result.request.headers.Authorization).toBe(FILTERED);
  });

  it("beforeSendTransaction scrubs the user email but keeps the non-PII id", () => {
    const result = opts.beforeSendTransaction!({
      type: "transaction",
      transaction: "checkout",
      user: { email: "user@example.com", id: "u1" },
    } as never) as { user: { email: string; id: string } };

    expect(result.user.email).toBe(FILTERED);
    expect(result.user.id).toBe("u1");
  });

  it("beforeSendSpan scrubs PII in the span description, keeping structural ids", () => {
    const result = opts.beforeSendSpan!({
      span_id: "abc123",
      trace_id: "trace456",
      op: "db.query",
      description: "SELECT * FROM users WHERE email = 'user@example.com'",
      data: {},
      start_timestamp: 0,
    } as never) as { description: string; span_id: string; op: string };

    expect(result.description).not.toContain("user@example.com");
    expect(result.description).toContain(FILTERED);
    expect(result.span_id).toBe("abc123");
    expect(result.op).toBe("db.query");
  });

  it("beforeSendSpan scrubs PII in span data, preserving non-PII string/number values", () => {
    const result = opts.beforeSendSpan!({
      span_id: "abc123",
      trace_id: "trace456",
      op: "http.client",
      description: "GET /api/users",
      data: {
        "url.full": `https://api.example.com/users?token=${JWT}`,
        "url.query": "email=user@example.com&step=2",
        "http.method": "GET",
        "http.status_code": 200,
      },
      start_timestamp: 0,
    } as never) as { data: Record<string, unknown> };

    expect(result.data["url.full"]).not.toContain(JWT);
    expect(result.data["url.full"]).toContain(FILTERED);
    expect(result.data["url.query"]).not.toContain("user@example.com");
    expect(result.data["url.query"]).toContain(FILTERED);
    expect(result.data["http.method"]).toBe("GET");
    expect(result.data["http.status_code"]).toBe(200);
  });
});
